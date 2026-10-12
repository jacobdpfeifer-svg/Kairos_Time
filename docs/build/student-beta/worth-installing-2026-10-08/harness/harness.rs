//! Walkthrough harness: the app's real Rust file readers behind a CLI.
//! `harness <cmd> <user_root> <json-args>` -> one JSON value on stdout.
#![allow(dead_code)]
#[path = "../src/semester.rs"]
mod semester;
#[path = "../src/canvas.rs"]
mod canvas;
#[path = "../src/calendar.rs"]
mod calendar;
use serde_json::{json, Value};
use std::path::PathBuf;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let cmd = a[1].as_str();
    let root = PathBuf::from(&a[2]);
    let args: Value = serde_json::from_str(a.get(3).map(String::as_str).unwrap_or("{}")).unwrap_or(json!({}));
    let s = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let out: Result<Value, String> = match cmd {
        "read_semester" => {
            let today = if s("today").is_empty() { "2026-09-20T00:00:00Z".into() } else { s("today") };
            semester::read_semester(&root, &s("range"), &today).map(|v| serde_json::to_value(v).unwrap())
        }
        "read_sync_progress" => Ok(semester::read_sync_progress(&root)),
        "read_sync_health" => Ok(canvas::read_sync_health(&root)),
        "read_freshness" => Ok(canvas::read_freshness(&root)),
        "read_work_surface" => Ok(canvas::read_work_surface(&root, args.get("filters").unwrap_or(&json!({})))),
        "read_course_colors" => Ok(canvas::read_course_colors(&root)),
        "read_course_map" => Ok(canvas::read_course_map(&root, &s("courseId"))),
        "read_grade_truth" => Ok(canvas::read_grade_truth(&root, &s("courseId"))),
        "read_calendar_surface" => Ok(json!({
            "events": calendar::read_events(&root),
            "canvas_events": canvas::canvas_calendar_items(&root),
            "suggestions": calendar::read_suggestions(&root),
            "sync_health": canvas::read_sync_health(&root),
        })),
        "add_calendar_event" => serde_json::from_value(args.get("event").cloned().unwrap_or(json!({})))
            .map_err(|e| e.to_string())
            .and_then(|ev| calendar::append_event(&root, ev))
            .map(|v| serde_json::to_value(v).unwrap()),
        "dismiss_calendar_suggestion" => calendar::dismiss_suggestion(&root, &s("sourceMessageId")).map(|_| Value::Null),
        _ => Err(format!("harness: no rust reader for {cmd}")),
    };
    match out {
        Ok(v) => println!("{}", json!({"ok": true, "value": v})),
        Err(e) => println!("{}", json!({"ok": false, "error": e})),
    }
}
