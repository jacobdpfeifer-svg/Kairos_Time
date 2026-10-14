//! Read-only Canvas reliability projections. Never parse Canvas JSON in React.

use serde_json::{json, Value};
use std::fs;
use std::path::Path;

fn reliability_enabled() -> bool {
    !matches!(std::env::var("KAIROS_CANVAS_RELIABILITY").ok().as_deref(), Some("0") | Some("false"))
}

fn canvas_root(user_root: &Path) -> std::path::PathBuf {
    user_root.join("inbox").join("canvas")
}

fn read_json(path: &Path) -> Option<Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
}

/// Freshness dashboard view model (`inbox/freshness/dashboard.json`), or null before the first tick.
pub fn read_freshness(user_root: &Path) -> Value {
    read_json(&user_root.join("inbox").join("freshness").join("dashboard.json")).unwrap_or(Value::Null)
}

/// Cost of skipping upcoming work (`inbox/freshness/skip-costs.json`), keyed
/// `course_id:assignment_id`, or `{}` before the first freshness run.
pub fn read_skip_costs(user_root: &Path) -> Value {
    match read_json(&user_root.join("inbox").join("freshness").join("skip-costs.json")) {
        Some(Value::Object(map)) => Value::Object(map),
        _ => json!({}),
    }
}

/// Course card colours (`inbox/courses/colors.json`, written by sync from
/// `users/self/colors`) as `{ course_id: "#rrggbb" }`. Only hex values pass.
pub fn read_course_colors(user_root: &Path) -> Value {
    let raw = read_json(&user_root.join("inbox").join("courses").join("colors.json"));
    let mut out = serde_json::Map::new();
    if let Some(Value::Object(map)) = raw {
        for (id, v) in map {
            let ok_id = !id.is_empty() && id.chars().all(|c| c.is_ascii_digit());
            if let Some(hex) = v.as_str() {
                let body = hex.strip_prefix('#').unwrap_or("");
                let ok_hex = (body.len() == 3 || body.len() == 6) && body.chars().all(|c| c.is_ascii_hexdigit());
                if ok_id && ok_hex {
                    out.insert(id, json!(hex.to_ascii_lowercase()));
                }
            }
        }
    }
    Value::Object(out)
}

fn pointer(user_root: &Path) -> Option<Value> {
    read_json(&canvas_root(user_root).join("projections").join("current.json"))
}

fn proj_dir(user_root: &Path) -> Option<std::path::PathBuf> {
    let ptr = pointer(user_root)?;
    let path = ptr.get("path")?.as_str()?;
    let p = Path::new(path);
    let root = fs::canonicalize(canvas_root(user_root).join("projections")).ok()?;
    let p = fs::canonicalize(p).ok()?;
    if p.starts_with(&root) && p != root {
        Some(p)
    } else {
        None
    }
}

fn http_url(v: &Value) -> Value {
    match v.as_str() {
        Some(u) if u.starts_with("https://") || u.starts_with("http://") => json!(u),
        _ => Value::Null,
    }
}

fn empty_health() -> Value {
    json!({
        "state": "empty_unverified",
        "surfaces_enabled": false,
        "sync_id": null,
        "as_of": null,
        "inspect_in_canvas": true,
        "empty_means": "no_successful_generation",
        "failed_endpoints": [],
        "named_courses_failed": [],
        "truncated": []
    })
}

pub fn read_sync_health(user_root: &Path) -> Value {
    if !reliability_enabled() {
        let mut h = empty_health();
        if let Some(obj) = h.as_object_mut() {
            obj.insert("surfaces_enabled".into(), json!(false));
            obj.insert("state".into(), json!("blocked"));
            obj.insert("blocked_reason".into(), json!("feature_flag"));
        }
        return h;
    }
    match proj_dir(user_root) {
        Some(dir) => read_json(&dir.join("sync-health.json")).unwrap_or_else(empty_health),
        None => empty_health(),
    }
}

pub fn read_work_surface(user_root: &Path, filters: &Value) -> Value {
    let health = read_sync_health(user_root);
    let Some(dir) = proj_dir(user_root) else {
        return json!({
            "sync_id": health.get("sync_id"),
            "health_state": health.get("state"),
            "as_of": health.get("as_of"),
            "inspect_in_canvas": true,
            "buckets": {},
            "items": [],
            "empty_means": health.get("empty_means")
        });
    };
    let mut surface = read_json(&dir.join("work-surface.json")).unwrap_or(json!({}));
    if let Some(obj) = surface.as_object_mut() {
        obj.insert("health_state".into(), health.get("state").cloned().unwrap_or(json!(null)));
        obj.insert("sync_id".into(), health.get("sync_id").cloned().unwrap_or(json!(null)));
    }
    let course_id = filters.get("course_id").and_then(|v| v.as_str());
    if let Some(cid) = course_id {
        if let Some(items) = surface.get_mut("items").and_then(|v| v.as_array_mut()) {
            items.retain(|it| it.get("course_id").and_then(|c| c.as_str()) == Some(cid));
        }
        if let Some(buckets) = surface.get_mut("buckets").and_then(|v| v.as_object_mut()) {
            for rows in buckets.values_mut() {
                if let Some(rows) = rows.as_array_mut() {
                    rows.retain(|it| it.get("course_id").and_then(|c| c.as_str()) == Some(cid));
                }
            }
        }
    }
    let bucket = filters.get("bucket").and_then(|v| v.as_str());
    let state = filters.get("submission_state").and_then(|v| v.as_str());
    if bucket.is_some() || state.is_some() {
        let allowed_ids: Option<std::collections::HashSet<String>> = bucket.map(|b| {
            surface
                .get("buckets")
                .and_then(|all| all.get(b))
                .and_then(|v| v.as_array())
                .map(|rows| {
                rows.iter()
                    .filter_map(|row| row.get("id").and_then(|id| id.as_str()).map(String::from))
                    .collect()
                })
                .unwrap_or_default()
        });
        let keep = |it: &Value| {
            let bucket_ok = allowed_ids
                .as_ref()
                .map(|ids| it.get("id").and_then(|id| id.as_str()).is_some_and(|id| ids.contains(id)))
                .unwrap_or(true);
            let state_ok = state
                .map(|s| it.get("submission_state").and_then(|v| v.as_str()) == Some(s))
                .unwrap_or(true);
            bucket_ok && state_ok
        };
        if let Some(items) = surface.get_mut("items").and_then(|v| v.as_array_mut()) {
            items.retain(keep);
        }
        if let Some(buckets) = surface.get_mut("buckets").and_then(|v| v.as_object_mut()) {
            for (name, rows) in buckets.iter_mut() {
                if bucket.is_some_and(|selected| selected != name) {
                    *rows = Value::Array(Vec::new());
                } else if let Some(rows) = rows.as_array_mut() {
                    rows.retain(keep);
                }
            }
        }
    }
    surface
}

pub fn read_course_map(user_root: &Path, course_id: &str) -> Value {
    let health = read_sync_health(user_root);
    let Some(dir) = proj_dir(user_root) else {
        return json!({ "health_state": health.get("state"), "sync_id": health.get("sync_id"), "course": { "id": course_id } });
    };
    let mut map = read_json(&dir.join("course-map").join(format!("{course_id}.json")))
        .unwrap_or(json!({ "course": { "id": course_id } }));
    if let Some(url) = map.pointer_mut("/course/html_url") {
        *url = http_url(url);
    }
    map
}

pub fn read_grade_truth(user_root: &Path, course_id: &str) -> Value {
    let Some(dir) = proj_dir(user_root) else {
        return json!({ "course_id": course_id, "canvas_reported": { "status": "cannot_calculate" } });
    };
    read_json(&dir.join("grade-truth").join(format!("{course_id}.json"))).unwrap_or(json!({
        "course_id": course_id
    }))
}

pub fn canvas_calendar_items(user_root: &Path) -> Vec<Value> {
    let surface = read_work_surface(user_root, &json!({}));
    let items = surface.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    items
        .into_iter()
        .filter(|it| it.get("effective_due_at").and_then(|d| d.as_str()).is_some())
        .map(|it| {
            let start = it.get("effective_due_at").and_then(|d| d.as_str()).unwrap_or("").to_string();
            json!({
                "id": it.get("id"),
                "kind": "canvas-due",
                "title": it.get("title"),
                "start": start,
                "end": start,
                "course_id": it.get("course_id"),
                "html_url": http_url(it.get("html_url").unwrap_or(&Value::Null)),
                "family": "canvas",
                "submission_state": it.get("submission_state"),
                "disagreements": it.get("disagreements")
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn course_colors_keep_only_hex_by_numeric_id() {
        let dir = env::temp_dir().join(format!("pn-cc-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(read_course_colors(&dir), json!({}));
        fs::create_dir_all(dir.join("inbox/courses")).unwrap();
        fs::write(
            dir.join("inbox/courses/colors.json"),
            r##"{"101":"#E1AD49","202":"#f60","x":"#111111","303":"red","404":"#12345g"}"##,
        )
        .unwrap();
        assert_eq!(read_course_colors(&dir), json!({"101":"#e1ad49","202":"#f60"}));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_unverified_without_pointer() {
        let dir = env::temp_dir().join(format!("pn-cv-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("inbox")).unwrap();
        let h = read_sync_health(&dir);
        assert_eq!(h["state"], "empty_unverified");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_projection_pointer() {
        let dir = env::temp_dir().join(format!("pn-cv2-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let proj = dir.join("inbox/canvas/projections/sync-a");
        fs::create_dir_all(&proj).unwrap();
        fs::write(
            proj.join("sync-health.json"),
            r#"{"state":"fresh_complete","sync_id":"sync-a","surfaces_enabled":true,"as_of":"2026-09-21T18:00:00Z"}"#,
        )
        .unwrap();
        fs::write(
            proj.join("work-surface.json"),
            r#"{"sync_id":"sync-a","items":[{"id":"t|1|assignment|9","course_id":"1","effective_due_at":"2026-09-22T16:00:00Z","title":"HW","html_url":"https://canvas.example/x"}]}"#,
        )
        .unwrap();
        fs::create_dir_all(proj.join("grade-truth")).unwrap();
        fs::write(
            dir.join("inbox/canvas/projections/current.json"),
            format!(r#"{{"sync_id":"sync-a","path":"{}"}}"#, proj.display()),
        )
        .unwrap();
        let h = read_sync_health(&dir);
        assert_eq!(h["sync_id"], "sync-a");
        let items = canvas_calendar_items(&dir);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["family"], "canvas");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn filters_work_surface_by_bucket_and_submission_state() {
        let dir = env::temp_dir().join(format!("pn-cv4-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let proj = dir.join("inbox/canvas/projections/sync-a");
        fs::create_dir_all(&proj).unwrap();
        fs::write(
            proj.join("sync-health.json"),
            r#"{"state":"fresh_complete","sync_id":"sync-a","surfaces_enabled":true,"as_of":"2026-09-21T18:00:00Z"}"#,
        )
        .unwrap();
        fs::write(
            proj.join("work-surface.json"),
            r#"{
              "sync_id":"sync-a",
              "items":[
                {"id":"t|1|assignment|9","course_id":"1","submission_state":"missing","title":"Missing"},
                {"id":"t|1|assignment|10","course_id":"1","submission_state":"submitted","title":"Submitted"}
              ],
              "buckets":{
                "missing":[{"id":"t|1|assignment|9","course_id":"1","submission_state":"missing","title":"Missing"}],
                "submitted":[{"id":"t|1|assignment|10","course_id":"1","submission_state":"submitted","title":"Submitted"}]
              }
            }"#,
        )
        .unwrap();
        fs::write(
            dir.join("inbox/canvas/projections/current.json"),
            format!(r#"{{"sync_id":"sync-a","path":"{}"}}"#, proj.display()),
        )
        .unwrap();
        let filtered = read_work_surface(&dir, &json!({ "bucket": "missing" }));
        assert_eq!(filtered["items"].as_array().unwrap().len(), 1);
        assert_eq!(filtered["items"][0]["submission_state"], "missing");
        assert_eq!(filtered["buckets"]["submitted"].as_array().unwrap().len(), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn failed_projection_keeps_previous_pointer() {
        let dir = env::temp_dir().join(format!("pn-cv3-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let a = dir.join("inbox/canvas/projections/sync-a");
        fs::create_dir_all(&a).unwrap();
        fs::write(a.join("sync-health.json"), r#"{"state":"fresh_complete","sync_id":"sync-a"}"#).unwrap();
        fs::write(
            dir.join("inbox/canvas/projections/current.json"),
            format!(r#"{{"sync_id":"sync-a","path":"{}"}}"#, a.display()),
        )
        .unwrap();
        fs::create_dir_all(dir.join("inbox/canvas/projections/sync-b")).unwrap();
        let h = read_sync_health(&dir);
        assert_eq!(h["sync_id"], "sync-a");
        let _ = fs::remove_dir_all(&dir);
    }
}
