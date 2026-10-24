//! Typed read of the shadow work-state projection. No raw paths cross this boundary.

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

fn read_json(path: &Path) -> Option<Value> {
    fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok())
}

fn generations_root(user_root: &Path) -> PathBuf {
    user_root.join("inbox").join("work-state").join("v1").join("generations")
}

fn confined(user_root: &Path, rel: &str) -> Option<PathBuf> {
    if rel.is_empty() || rel.contains('\0') || rel.contains("..") || rel.starts_with('/') || rel.contains('\\') {
        return None;
    }
    let base = fs::canonicalize(generations_root(user_root)).ok()?;
    let candidate = fs::canonicalize(user_root.join(rel)).ok()?;
    if candidate.starts_with(&base) && candidate != base {
        Some(candidate)
    } else {
        None
    }
}

fn valid_generation(value: &Value) -> bool {
    value.get("schema_version").and_then(|v| v.as_i64()) == Some(1)
        && value.get("work_items").and_then(|v| v.as_array()).is_some()
        && value.get("coverage").and_then(|v| v.as_object()).is_some()
}

/// Err carries why, so a fallback reports the real reason instead of guessing.
fn load_pair(dir: &Path) -> Result<(Value, Value), &'static str> {
    let state = read_json(&dir.join("state.json")).ok_or("malformed")?;
    let health = read_json(&dir.join("health.json")).ok_or("malformed")?;
    if state.get("schema_version").and_then(|v| v.as_i64()) != Some(1)
        || health.get("schema_version").and_then(|v| v.as_i64()) != Some(1)
    {
        return Err("schema");
    }
    if !valid_generation(&state) {
        return Err("malformed");
    }
    Ok((state, health))
}

fn missing(reason: &str) -> Value {
    json!({ "ok": false, "reason": reason, "fell_back": false, "state": null, "health": null })
}

/// Current work-state snapshot, or an honest failure. Never a filesystem path.
pub fn read_work_state(user_root: &Path) -> Value {
    let Some(pointer) = read_json(&user_root.join("inbox").join("work-state").join("v1").join("current.json")) else {
        return missing("missing");
    };
    if pointer.get("schema_version").and_then(|v| v.as_i64()) != Some(1) {
        return missing("schema");
    }
    let Some(rel) = pointer.get("path").and_then(|v| v.as_str()) else {
        return missing("schema");
    };
    // A pointer with no generations directory is a torn or half-built profile,
    // not an escape attempt. Saying "unconfined" there would blame the student's
    // data for a path problem it does not have.
    if !generations_root(user_root).is_dir() {
        return missing("malformed");
    }
    let Some(dir) = confined(user_root, rel) else {
        return missing("unconfined");
    };
    let why = match load_pair(&dir) {
        Ok((state, health)) => {
            return json!({ "ok": true, "reason": null, "fell_back": false, "state": state, "health": health })
        }
        Err(why) => why,
    };
    if let Some(previous) = pointer.get("previous_generation_id").and_then(|v| v.as_str()) {
        if !previous.is_empty() && !previous.contains("..") && !previous.contains('/') && !previous.contains('\\') {
            let previous_rel = format!("inbox/work-state/v1/generations/{previous}");
            if let Some(previous_dir) = confined(user_root, &previous_rel) {
                if let Ok((state, health)) = load_pair(&previous_dir) {
                    return json!({ "ok": true, "reason": why, "fell_back": true, "state": state, "health": health });
                }
            }
        }
    }
    missing(why)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn root(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("pn-ws-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn write_gen(dir: &Path, id: &str, title: &str) {
        let gen = dir.join("inbox/work-state/v1/generations").join(id);
        fs::create_dir_all(&gen).unwrap();
        fs::write(
            gen.join("state.json"),
            format!(
                r#"{{"schema_version":1,"coverage":{{"canvas":"ok"}},"work_items":[{{"id":"{title}","title":"{title}"}}]}}"#
            ),
        )
        .unwrap();
        fs::write(gen.join("health.json"), r#"{"schema_version":1}"#).unwrap();
    }

    #[test]
    fn a_pointer_without_generations_is_not_called_unconfined() {
        let dir = root("torn");
        fs::create_dir_all(dir.join("inbox/work-state/v1")).unwrap();
        fs::write(
            dir.join("inbox/work-state/v1/current.json"),
            r#"{"schema_version":1,"path":"inbox/work-state/v1/generations/ws-a","previous_generation_id":null}"#,
        )
        .unwrap();
        let read = read_work_state(&dir);
        assert_eq!(read["reason"], "malformed");
        assert!(read["state"].is_null());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_profile_is_not_an_empty_week() {
        let dir = root("missing");
        fs::create_dir_all(dir.join("inbox")).unwrap();
        let read = read_work_state(&dir);
        assert_eq!(read["ok"], false);
        assert_eq!(read["reason"], "missing");
        assert!(read["state"].is_null());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_a_confined_generation_and_rejects_escape() {
        let dir = root("confined");
        write_gen(&dir, "ws-a", "hw");
        fs::write(
            dir.join("inbox/work-state/v1/current.json"),
            r#"{"schema_version":1,"generation_id":"ws-a","path":"inbox/work-state/v1/generations/ws-a","content_hash":"x","previous_generation_id":null}"#,
        )
        .unwrap();
        let read = read_work_state(&dir);
        assert!(read["ok"].as_bool().unwrap(), "{read}");
        assert_eq!(read["state"]["work_items"][0]["title"], "hw");
        assert!(read.get("path").is_none());
        fs::write(
            dir.join("inbox/work-state/v1/current.json"),
            r#"{"schema_version":1,"path":"../../etc/passwd","previous_generation_id":null}"#,
        )
        .unwrap();
        let escaped = read_work_state(&dir);
        assert_eq!(escaped["reason"], "unconfined");
        assert!(escaped["state"].is_null());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_current_falls_back_to_the_previous_generation() {
        let dir = root("fallback");
        write_gen(&dir, "ws-old", "kept");
        write_gen(&dir, "ws-new", "gone");
        fs::write(dir.join("inbox/work-state/v1/generations/ws-new/state.json"), "{").unwrap();
        fs::write(
            dir.join("inbox/work-state/v1/current.json"),
            r#"{"schema_version":1,"path":"inbox/work-state/v1/generations/ws-new","previous_generation_id":"ws-old"}"#,
        )
        .unwrap();
        let read = read_work_state(&dir);
        assert_eq!(read["fell_back"], true);
        assert_eq!(read["reason"], "malformed");
        assert_eq!(read["state"]["work_items"][0]["title"], "kept");
        let _ = fs::remove_dir_all(&dir);
    }
}
