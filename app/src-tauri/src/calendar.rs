//! Local calendar JSONL + email-suggestion contract.
//! Google Calendar writes are not wired this round (ConfirmationGuard required).

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;

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

pub fn read_suggestions(user_root: &Path) -> Vec<CalendarSuggestion> {
    let dismissed: Vec<String> = fs::read_to_string(dismissed_path(user_root))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    read_jsonl::<CalendarSuggestion>(&suggestions_path(user_root))
        .into_iter()
        .filter(|s| !dismissed.iter().any(|id| id == &s.source_message_id))
        .collect()
}

pub fn append_event(user_root: &Path, mut event: CalendarEvent) -> Result<CalendarEvent, String> {
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

pub fn dismiss_suggestion(user_root: &Path, source_message_id: &str) -> Result<(), String> {
    let path = dismissed_path(user_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut ids: Vec<String> = fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    if !ids.iter().any(|id| id == source_message_id) {
        ids.push(source_message_id.to_string());
    }
    fs::write(path, serde_json::to_string_pretty(&ids).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(())
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
        let _ = fs::remove_dir_all(&dir);
    }
}
