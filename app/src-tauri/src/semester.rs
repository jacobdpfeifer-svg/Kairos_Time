//! Home semester line: read schema-2 `inbox/study-sources/*.json`.
//! Weights and term inference are already stored by the JS sync — this module
//! only aggregates and filters. The React shell never parses Canvas payloads.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Term {
    pub start_at: Option<String>,
    pub end_at: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SemesterTick {
    pub id: String,
    pub course_id: String,
    pub course_label: String,
    pub color: String,
    pub title: String,
    pub kind: String,
    pub due_at: Option<String>,
    pub points_possible: Option<f64>,
    pub weight_share: f64,
    pub html_url: Option<String>,
    pub completed: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SemesterCourse {
    pub id: String,
    pub label: String,
    pub code: String,
    pub name: String,
    pub color: String,
    pub term: Term,
    pub ticks: Vec<SemesterTick>,
    pub counts: SemesterCounts,
}

#[derive(Debug, Clone, Serialize)]
pub struct SemesterCounts {
    pub assignments: u32,
    pub quizzes: u32,
    pub exams: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct SemesterSurface {
    pub courses: Vec<SemesterCourse>,
    pub range: String,
    pub window_start: String,
    pub window_end: String,
    pub today: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RangeKind {
    Month1,
    Month2,
    Month3,
    Full,
}

impl RangeKind {
    pub fn parse(s: &str) -> Self {
        match s {
            "2m" | "2" | "2 months" => Self::Month2,
            "3m" | "3" | "3 months" => Self::Month3,
            "full" | "semester" => Self::Full,
            _ => Self::Month1,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Month1 => "1m",
            Self::Month2 => "2m",
            Self::Month3 => "3m",
            Self::Full => "full",
        }
    }
}

pub fn skip_source_file(name: &str) -> bool {
    matches!(name, "status.json" | "progress.json")
}

fn parse_millis(iso: &str) -> Option<i64> {
    // Accept ...Z and ...+00:00. Date-only → midnight UTC.
    let s = iso.trim();
    if s.is_empty() {
        return None;
    }
    let normalized = if s.len() == 10 && s.as_bytes()[4] == b'-' {
        format!("{s}T00:00:00Z")
    } else {
        s.to_string()
    };
    // Manual parse YYYY-MM-DDTHH:MM:SS
    let bytes = normalized.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let y: i64 = std::str::from_utf8(&bytes[0..4]).ok()?.parse().ok()?;
    let mo: i64 = std::str::from_utf8(&bytes[5..7]).ok()?.parse().ok()?;
    let d: i64 = std::str::from_utf8(&bytes[8..10]).ok()?.parse().ok()?;
    let h: i64 = std::str::from_utf8(&bytes[11..13]).ok()?.parse().ok()?;
    let mi: i64 = std::str::from_utf8(&bytes[14..16]).ok()?.parse().ok()?;
    let se: i64 = std::str::from_utf8(&bytes[17..19]).ok()?.parse().ok()?;
    Some(ymd_hms_millis(y, mo, d, h, mi, se))
}

fn ymd_hms_millis(y: i64, mo: i64, d: i64, h: i64, mi: i64, se: i64) -> i64 {
    let mut day = 0i64;
    for yy in 1970..y {
        day += if is_leap(yy) { 366 } else { 365 };
    }
    const MD: [i64; 12] = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    day += MD[(mo as usize).saturating_sub(1)] + d - 1;
    if mo > 2 && is_leap(y) {
        day += 1;
    }
    ((day * 86400) + h * 3600 + mi * 60 + se) * 1000
}

fn is_leap(y: i64) -> bool {
    y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)
}

fn add_months(iso: &str, months: i64) -> String {
    let s = iso.trim();
    let y: i64 = s.get(0..4).and_then(|x| x.parse().ok()).unwrap_or(2026);
    let mo: i64 = s.get(5..7).and_then(|x| x.parse().ok()).unwrap_or(1);
    let rest = s.get(7..).unwrap_or("T00:00:00Z");
    let mut nm = mo + months;
    let mut ny = y;
    while nm > 12 {
        nm -= 12;
        ny += 1;
    }
    format!("{ny:04}-{nm:02}{rest}")
}

fn json_f64(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_i64().map(|n| n as f64))
        .or_else(|| v.as_u64().map(|n| n as f64))
}

fn json_str(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| x.as_str().map(|s| s.to_string()))
}

pub fn course_from_json(raw: &Value) -> Option<SemesterCourse> {
    let course = raw.get("course")?;
    let id = json_str(course.get("id"))?;
    let label = json_str(course.get("label")).unwrap_or_else(|| id.clone());
    let code = json_str(course.get("code")).unwrap_or_default();
    let name = json_str(course.get("name")).unwrap_or_default();
    let color = json_str(course.get("color")).unwrap_or_else(|| "#2E86AB".into());
    let term_v = raw.get("term");
    let term = Term {
        start_at: term_v.and_then(|t| json_str(t.get("start_at"))),
        end_at: term_v.and_then(|t| json_str(t.get("end_at"))),
        source: term_v
            .and_then(|t| json_str(t.get("source")))
            .unwrap_or_else(|| "inferred".into()),
    };
    let mut ticks = Vec::new();
    let mut counts = SemesterCounts {
        assignments: 0,
        quizzes: 0,
        exams: 0,
    };
    if let Some(items) = raw.get("items").and_then(|v| v.as_array()) {
        for it in items {
            let kind = json_str(it.get("kind")).unwrap_or_else(|| "assignment".into());
            match kind.as_str() {
                "quiz" => counts.quizzes += 1,
                "exam" => counts.exams += 1,
                "assignment" => counts.assignments += 1,
                _ => {}
            }
            ticks.push(SemesterTick {
                id: json_str(it.get("id")).unwrap_or_default(),
                course_id: id.clone(),
                course_label: label.clone(),
                color: color.clone(),
                title: json_str(it.get("title")).unwrap_or_default(),
                kind,
                due_at: json_str(it.get("due_at")),
                points_possible: it.get("points_possible").and_then(json_f64),
                weight_share: it.get("weight_share").and_then(json_f64).unwrap_or(0.0),
                html_url: json_str(it.get("html_url")),
                completed: it.get("completed").and_then(|v| v.as_bool()).unwrap_or(false),
                description: json_str(it.get("description")).unwrap_or_default(),
            });
        }
    }
    Some(SemesterCourse {
        id,
        label,
        code,
        name,
        color,
        term,
        ticks,
        counts,
    })
}

pub fn window_for(range: RangeKind, today: &str, courses: &[SemesterCourse]) -> (String, String) {
    let start = today.to_string();
    match range {
        RangeKind::Month1 => (start.clone(), add_months(today, 1)),
        RangeKind::Month2 => (start.clone(), add_months(today, 2)),
        RangeKind::Month3 => (start.clone(), add_months(today, 3)),
        RangeKind::Full => {
            let mut min_s = today.to_string();
            let mut max_s = today.to_string();
            for c in courses {
                if let Some(s) = &c.term.start_at {
                    if parse_millis(s).unwrap_or(i64::MAX) < parse_millis(&min_s).unwrap_or(0) {
                        min_s = s.clone();
                    }
                }
                if let Some(e) = &c.term.end_at {
                    if parse_millis(e).unwrap_or(0) > parse_millis(&max_s).unwrap_or(0) {
                        max_s = e.clone();
                    }
                }
            }
            (min_s, max_s)
        }
    }
}

pub fn in_window(due: &str, start: &str, end: &str) -> bool {
    let Some(t) = parse_millis(due) else {
        return false;
    };
    let a = parse_millis(start).unwrap_or(i64::MIN);
    let b = parse_millis(end).unwrap_or(i64::MAX);
    t >= a && t <= b
}

pub fn read_semester(user_root: &Path, range: &str, today: &str) -> Result<SemesterSurface, String> {
    let dir = user_root.join("inbox").join("study-sources");
    let mut courses = Vec::new();
    if dir.is_dir() {
        let mut entries: Vec<_> = fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.ends_with(".json") || skip_source_file(&name) {
                continue;
            }
            let text = fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
            let raw: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            if let Some(c) = course_from_json(&raw) {
                courses.push(c);
            }
        }
    }
    let kind = RangeKind::parse(range);
    let (window_start, window_end) = window_for(kind, today, &courses);
    for c in &mut courses {
        c.ticks
            .retain(|t| t.due_at.as_deref().is_some_and(|d| in_window(d, &window_start, &window_end)));
        c.ticks.sort_by(|a, b| a.due_at.cmp(&b.due_at));
    }
    Ok(SemesterSurface {
        courses,
        range: kind.as_str().into(),
        window_start,
        window_end,
        today: today.into(),
    })
}

pub fn read_sync_progress(user_root: &Path) -> Value {
    let path = user_root.join("inbox").join("study-sources").join("progress.json");
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| serde_json::json!({ "phase": "idle", "courses": [] }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn filters_ticks_to_one_month_from_today() {
        let raw = json!({
            "course": {"id": "1", "label": "MATH", "code": "MATH", "name": "Calc", "color": "#2E86AB"},
            "term": {"start_at": "2026-08-24T00:00:00Z", "end_at": "2026-12-18T00:00:00Z", "source": "canvas"},
            "items": [
                {"id": "a", "title": "soon", "kind": "assignment", "due_at": "2026-09-25T00:00:00Z", "weight_share": 0.1, "completed": false},
                {"id": "b", "title": "later", "kind": "exam", "due_at": "2026-12-10T00:00:00Z", "weight_share": 0.5, "completed": false}
            ]
        });
        let course = course_from_json(&raw).unwrap();
        assert_eq!(course.counts.exams, 1);
        let (start, end) = window_for(RangeKind::Month1, "2026-09-20T00:00:00Z", std::slice::from_ref(&course));
        assert!(in_window("2026-09-25T00:00:00Z", &start, &end));
        assert!(!in_window("2026-12-10T00:00:00Z", &start, &end));
    }

    #[test]
    fn skips_progress_and_status() {
        assert!(skip_source_file("progress.json"));
        assert!(skip_source_file("status.json"));
        assert!(!skip_source_file("1300.json"));
    }
}
