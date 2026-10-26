//! Local calendar JSONL + email-suggestion contract.
//! Google Calendar writes are not wired this round (ConfirmationGuard required).

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use crate::userfile::write_atomic;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    #[serde(default)]
    pub id: String,
    pub kind: String,
    pub title: String,
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub course_id: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarSuggestion {
    pub source_message_id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    #[serde(default)]
    pub confidence: f64,
    #[serde(default)]
    pub why: String,
    #[serde(default)]
    pub dismissed: bool,
}

fn read_jsonl<T: for<'de> Deserialize<'de>>(path: &Path) -> Vec<T> {
    let Ok(file) = fs::File::open(path) else {
        return Vec::new();
    };
    let reader = BufReader::new(file);
    let mut rows = Vec::new();
    for line in reader.lines().map_while(Result::ok) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(row) = serde_json::from_str::<T>(line) {
            rows.push(row);
        }
    }
    rows
}

pub fn events_path(user_root: &Path) -> std::path::PathBuf {
    user_root.join("inbox").join("calendar.jsonl")
}

pub fn suggestions_path(user_root: &Path) -> std::path::PathBuf {
    user_root.join("inbox").join("calendar-suggestions.jsonl")
}

pub fn dismissed_path(user_root: &Path) -> std::path::PathBuf {
    user_root.join("inbox").join("calendar-suggestions-dismissed.json")
}

pub fn read_events(user_root: &Path) -> Vec<CalendarEvent> {
    read_jsonl(&events_path(user_root))
}

fn read_dismissed(path: &Path) -> Vec<String> {
    fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn read_suggestions(user_root: &Path) -> Vec<CalendarSuggestion> {
    let dismissed = read_dismissed(&dismissed_path(user_root));
    read_jsonl::<CalendarSuggestion>(&suggestions_path(user_root))
        .into_iter()
        .filter(|s| !dismissed.iter().any(|id| id == &s.source_message_id))
        .collect()
}

fn too_long(value: &str, max: usize) -> bool {
    value.chars().count() > max
}

/// Bounds on what the webview may append: these rows are re-read on every
/// calendar render and handed to the planning prompt.
fn validate_event(event: &CalendarEvent) -> Result<(), String> {
    if event.title.trim().is_empty() || too_long(&event.title, 200) {
        return Err("event title must be 1–200 characters".into());
    }
    if too_long(&event.kind, 32) || too_long(&event.id, 128) || too_long(&event.start, 64) || too_long(&event.end, 64) {
        return Err("event field is too long".into());
    }
    if event.course_id.as_deref().is_some_and(|v| too_long(v, 64))
        || event.color.as_deref().is_some_and(|v| too_long(v, 32))
        || event.note.as_deref().is_some_and(|v| too_long(v, 2000))
    {
        return Err("event field is too long".into());
    }
    Ok(())
}

pub fn append_event(user_root: &Path, mut event: CalendarEvent) -> Result<CalendarEvent, String> {
    validate_event(&event)?;
    if event.id.is_empty() {
        event.id = format!(
            "cal-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        );
    }
    let path = events_path(user_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let line = serde_json::to_string(&event).map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    Ok(event)
}

pub fn remove_event(user_root: &Path, id: &str) -> Result<(), String> {
    if id.is_empty() || too_long(id, 128) {
        return Err("invalid event id".into());
    }
    // Undo drops one line and copies the rest through byte for byte. Rebuilding
    // the file from parsed rows would silently delete any line this build cannot
    // read and strip any field a later one adds.
    let path = events_path(user_root);
    let Ok(body) = fs::read_to_string(&path) else {
        return Ok(());
    };
    let mut out = String::with_capacity(body.len());
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let matches_id = serde_json::from_str::<CalendarEvent>(trimmed).is_ok_and(|event| event.id == id);
        if matches_id {
            continue;
        }
        out.push_str(trimmed);
        out.push('\n');
    }
    write_atomic(&path, out.as_bytes())
}

pub fn dismiss_suggestion(user_root: &Path, source_message_id: &str) -> Result<(), String> {
    if source_message_id.is_empty() || too_long(source_message_id, 300) {
        return Err("invalid suggestion id".into());
    }
    let path = dismissed_path(user_root);
    let mut ids = read_dismissed(&path);
    if !ids.iter().any(|id| id == source_message_id) {
        ids.push(source_message_id.to_string());
    }
    write_atomic(&path, serde_json::to_string_pretty(&ids).map_err(|e| e.to_string())?.as_bytes())
}

pub fn restore_suggestion(user_root: &Path, source_message_id: &str) -> Result<(), String> {
    if source_message_id.is_empty() || too_long(source_message_id, 300) {
        return Err("invalid suggestion id".into());
    }
    let path = dismissed_path(user_root);
    let mut ids = read_dismissed(&path);
    ids.retain(|id| id != source_message_id);
    write_atomic(&path, serde_json::to_string_pretty(&ids).map_err(|e| e.to_string())?.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn append_and_read_event() {
        let dir = env::temp_dir().join(format!("pn-cal-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("inbox")).unwrap();
        let ev = append_event(
            &dir,
            CalendarEvent {
                id: "cal-1".into(),
                kind: "study".into(),
                title: "Chain rule block".into(),
                start: "2026-09-21T18:00:00Z".into(),
                end: "2026-09-21T19:00:00Z".into(),
                course_id: Some("1300".into()),
                color: None,
                note: None,
            },
        )
        .unwrap();
        assert_eq!(ev.id, "cal-1");
        let rows = read_events(&dir);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Chain rule block");
        // A line this build cannot parse must survive someone else's undo.
        {
            use std::io::Write as _;
            let mut file = OpenOptions::new().append(true).open(events_path(&dir)).unwrap();
            writeln!(file, "{{not json").unwrap();
        }
        remove_event(&dir, "cal-1").unwrap();
        assert!(read_events(&dir).is_empty());
        assert!(fs::read_to_string(events_path(&dir)).unwrap().contains("{not json"));
        // Removing an id that is not there is not an error and changes nothing.
        remove_event(&dir, "cal-404").unwrap();
        assert!(fs::read_to_string(events_path(&dir)).unwrap().contains("{not json"));
        fs::write(
            suggestions_path(&dir),
            "{\"source_message_id\":\"msg-1\",\"title\":\"Block\",\"start\":\"2026-09-21T18:00:00Z\",\"end\":\"2026-09-21T19:00:00Z\"}\n",
        )
        .unwrap();
        assert_eq!(read_suggestions(&dir).len(), 1);
        dismiss_suggestion(&dir, "msg-1").unwrap();
        assert!(read_suggestions(&dir).is_empty());
        restore_suggestion(&dir, "msg-1").unwrap();
        assert_eq!(read_suggestions(&dir).len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
