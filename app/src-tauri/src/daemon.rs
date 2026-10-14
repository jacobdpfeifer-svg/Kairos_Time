//! Kairos local daemon — sync cadence, sensors, ledger.
//!
//! Canvas sync: every 2h on term weekdays, 6h weekends, plus event-driven when
//! the Chrome extension reports Canvas tab focus. Never sub-5-minute polling.
//!
//! Autostart: enable via tauri-plugin-autostart so the daemon runs on login.

use serde_json::Value;
use std::env;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::runtime::Runtime;

/// Weekday sync interval during term.
pub const SYNC_WEEKDAY: Duration = Duration::from_secs(2 * 60 * 60);
/// Weekend sync interval.
pub const SYNC_WEEKEND: Duration = Duration::from_secs(6 * 60 * 60);
/// Absolute floor — never poll Canvas more often than this.
pub const SYNC_FLOOR: Duration = Duration::from_secs(5 * 60);
/// Freshness tick: classify extension deltas, poll due feeds. No Canvas session;
/// feed cadence (10 min announcements, 60 min course/calendar) lives in the tick.
pub const FRESHNESS_TICK: Duration = Duration::from_secs(2 * 60);

pub fn next_sync_interval(is_weekend: bool) -> Duration {
    let candidate = if is_weekend {
        SYNC_WEEKEND
    } else {
        SYNC_WEEKDAY
    };
    if candidate < SYNC_FLOOR {
        SYNC_FLOOR
    } else {
        candidate
    }
}

/// Log a daemon tick (cadence / sync / boot).
pub fn tick_log(reason: &str) {
    eprintln!("[kairos-daemon] tick: {reason}");
}

fn run_status(mut cmd: Command, label: &str) -> Result<(), String> {
    let status = cmd
        .status()
        .map_err(|e| format!("failed to spawn {label}: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{label} exited with {status}"))
    }
}

/// Build a student-operated portable Canvas bundle from the last canonical
/// snapshot. The exporter writes Markdown/JSON and a ZIP under the profile's
/// inbox/export directory; no network request is made here.
pub fn run_canvas_export(rt: &Runtime, include_grades: bool) -> Result<String, String> {
    tick_log("export-canvas");
    let mut cmd = rt.browser_script("export-portable")?;
    cmd.env("EXPORT_INCLUDE_GRADES", if include_grades { "1" } else { "0" });
    let output = cmd
        .output()
        .map_err(|e| format!("failed to spawn Canvas export: {e}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() { format!("Canvas export exited with {}", output.status) } else { detail });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().rev().find(|line| !line.trim().is_empty()).map(str::to_string).ok_or_else(|| "Canvas export returned no result".into())
}

/// Shell `npm run sync` in browser/ with DEV_USER_ROOT / SCHOOL_SLUG when set.
pub fn run_canvas_sync(rt: &Runtime) -> Result<(), String> {
    tick_log("sync");
    let cmd = rt.browser_script("sync-canvas-canonical")?;
    run_status(cmd, "canvas sync")
}

/// `browser/scripts/school.mjs <args>`: school search / choose / enrich (docs/architecture/school-personalization.md).
/// Returns the script's single JSON line; `{ok:false,error}` becomes Err.
pub fn run_school_script(rt: &Runtime, args: &[&str]) -> Result<Value, String> {
    tick_log("school");
    let mut cmd = rt.browser_script("school")?;
    cmd.args(args);
    let output = cmd
        .output()
        .map_err(|e| format!("failed to spawn school script: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .ok_or_else(|| "school script produced no JSON output".to_string())?;
    let parsed: Value =
        serde_json::from_str(line).map_err(|e| format!("bad school JSON: {e}"))?;
    if parsed.get("ok").and_then(Value::as_bool) == Some(false) {
        return Err(parsed
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("school script failed")
            .to_string());
    }
    Ok(parsed)
}

pub fn canvas_stub() -> bool {
    matches!(
        env::var("KAIROS_STUB_CANVAS").ok().as_deref(),
        Some("1") | Some("true")
    )
}

/// Instructor-published material → `{user_root}/inbox/study-sources/` (Phase 3).
/// Headless; exits non-zero when the SSO session is missing, and the script
/// itself writes an honest status.json either way.
pub fn run_sync_study_sources(rt: &Runtime) -> Result<(), String> {
    tick_log("sync-study-sources");
    if canvas_stub() {
        return stub_sync_progress(rt);
    }
    let cmd = rt.browser_script("sync-study-sources")?;
    run_status(cmd, "study source sync")
}

fn stub_sync_progress(rt: &Runtime) -> Result<(), String> {
    use std::fs;
    let dir = rt.user_root.join("inbox").join("study-sources");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut courses = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.ends_with(".json") || crate::semester::skip_source_file(&name) {
                continue;
            }
            if let Ok(text) = fs::read_to_string(entry.path()) {
                if let Ok(raw) = serde_json::from_str::<Value>(&text) {
                    if let Some(c) = crate::semester::course_from_json(&raw) {
                        courses.push(serde_json::json!({
                            "id": c.id,
                            "label": c.label,
                            "color": c.color,
                            "assignments": c.counts.assignments,
                            "quizzes": c.counts.quizzes,
                            "exam_count": c.counts.exams,
                            "ok": true,
                        }));
                    }
                }
            }
        }
    }
    let progress = serde_json::json!({ "phase": "done", "courses": courses, "error": null });
    fs::write(dir.join("progress.json"), progress.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}

/// Shell `npm run open-canvas` for SSO login (onboarding "I signed in").
pub fn run_open_canvas(rt: &Runtime) -> Result<(), String> {
    tick_log("open-canvas");
    if canvas_stub() {
        return Ok(());
    }
    let mut cmd = rt.browser_script("open-canvas")?;
    // Keep stderr: a stale school sign-in exits 2 with a `login_expired:` line
    // that onboarding turns into "restart sign-in" guidance.
    let output = cmd
        .output()
        .map_err(|e| format!("failed to spawn open-canvas: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = stderr
        .lines()
        .rev()
        .find(|line| line.starts_with("login_expired"))
        .map(str::to_string);
    Err(detail.unwrap_or_else(|| format!("open-canvas exited with {}", output.status)))
}

/// Shell `npm run check-session` — headless probe of browser/.auth cookies.
/// Used by onboarding to skip the sign-in step when a session is already open.
pub fn run_check_canvas_session(rt: &Runtime) -> Result<bool, String> {
    tick_log("check-session");
    if canvas_stub() {
        return Ok(true);
    }
    let mut cmd = rt.browser_script("check-canvas-session")?;
    let output = cmd
        .output()
        .map_err(|e| format!("failed to spawn check-session: {e}"))?;
    if !output.status.success() {
        return Err(format!("check-session exited with {}", output.status));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .ok_or_else(|| "check-session produced no JSON output".to_string())?;
    let parsed: Value =
        serde_json::from_str(line).map_err(|e| format!("bad check-session JSON: {e}"))?;
    Ok(parsed.get("loggedIn").and_then(Value::as_bool).unwrap_or(false))
}

fn python_json(rt: &Runtime, module: &str, args: &[&str]) -> Result<Value, String> {
    rt.usable()?;
    let output = rt
        .python_module(module, args)
        .output()
        .map_err(|e| format!("failed to spawn {module}: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("{module} exited {}", output.status)
        } else {
            err
        });
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    serde_json::from_str(&raw).map_err(|e| format!("{module} JSON parse failed: {e}; raw={raw}"))
}

/// Due claims for the dock session. Empty `items` when nothing is scheduled.
pub fn run_due_reviews(rt: &Runtime) -> Result<Value, String> {
    tick_log("due-reviews");
    python_json(rt, "canvas_mcp.core.learn_loop", &["--json", "due"])
}

/// Record a retrieval score. `same_session` must stay false for a scheduled dock check.
pub fn run_record_review_outcome(
    rt: &Runtime,
    item_id: &str,
    outcome: &str,
    same_session: bool,
) -> Result<Value, String> {
    tick_log("review-outcome");
    let mut args = vec![
        "--json",
        "outcome",
        "--id",
        item_id,
        "--outcome",
        outcome,
    ];
    if same_session {
        args.push("--same-session");
    }
    python_json(rt, "canvas_mcp.core.learn_loop", &args)
}

/// Write the onboarding learning-profile games' answers via the Python CLI.
pub fn run_save_learning_profile(
    rt: &Runtime,
    practice_format: &str,
    autonomy: &str,
    chunk_size: &str,
    check_depth: &str,
    if_then: &str,
) -> Result<(), String> {
    tick_log("save-learning-profile");
    let output = rt
        .python_module(
        "canvas_mcp.core.learning_profile",
        &[
            "--json",
            "save",
            "--practice-format",
            practice_format,
            "--autonomy",
            autonomy,
            "--chunk-size",
            chunk_size,
            "--check-depth",
            check_depth,
            "--if-then",
            if_then,
        ],
    )
    .output()
    .map_err(|e| format!("failed to spawn learning_profile: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if err.is_empty() {
            format!("learning_profile exited {}", output.status)
        } else {
            err
        })
    }
}

/// Parse the tick's last JSON line → number of new change events.
pub fn parse_freshness_output(stdout: &str) -> Result<u64, String> {
    let line = stdout
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .ok_or_else(|| "freshness tick produced no JSON".to_string())?;
    let value: Value = serde_json::from_str(line).map_err(|e| format!("freshness JSON parse failed: {e}"))?;
    if value.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("freshness tick failed")
            .to_string());
    }
    Ok(value.get("new_events").and_then(Value::as_u64).unwrap_or(0))
}

/// One freshness tick (`browser/scripts/freshness-tick.mjs`).
pub fn run_freshness_tick(rt: &Runtime) -> Result<u64, String> {
    let output = rt
        .browser_script("freshness-tick")?
        .output()
        .map_err(|e| format!("failed to spawn freshness tick: {e}"))?;
    parse_freshness_output(&String::from_utf8_lossy(&output.stdout))
}

/// Keep Canvas changes flowing in while the app runs; `on_update` fires with
/// the count whenever a tick finds something new.
pub fn spawn_freshness_loop<F>(rt: Arc<Runtime>, on_update: F)
where
    F: Fn(u64) + Send + 'static,
{
    thread::spawn(move || loop {
        if !canvas_stub() {
            match run_freshness_tick(&rt) {
                Ok(0) => {}
                Ok(n) => {
                    tick_log("freshness");
                    on_update(n);
                }
                Err(e) => eprintln!("[kairos-daemon] freshness: {e}"),
            }
        }
        thread::sleep(FRESHNESS_TICK);
    });
}

/// Background cadence loop — logs ticks and optionally runs sync on each interval.
pub fn spawn_cadence_loop(rt: Arc<Runtime>) {
    thread::spawn(move || {
        loop {
            let weekend = is_weekend_now();
            let wait = next_sync_interval(weekend);
            thread::sleep(wait);
            tick_log(if weekend {
                "cadence-weekend"
            } else {
                "cadence-weekday"
            });
            if let Err(e) = run_canvas_sync(&rt) {
                eprintln!("[kairos-daemon] sync error: {e}");
            }
        }
    });
}

/// Study command bridge: the request JSON goes over stdin (no shell quoting,
/// no argv length limit) and the reply is the CLI's single JSON envelope.
/// Answer keys never appear in argv or logs.
/// Keys the renderer may never send: the clock, the profile root, and local
/// file paths are decided natively (adopted from candidate B's bridge).
const FORBIDDEN_REQUEST_KEYS: [&str; 5] = ["now", "user_root", "root", "path", "zone"];
const MAX_REQUEST_BYTES: usize = 256 * 1024;
const MAX_REPLY_BYTES: usize = 4 * 1024 * 1024;

pub fn validate_study_request(request: &Value) -> Result<(), String> {
    let object = request.as_object().ok_or("study request must be an object")?;
    match object.get("cmd").and_then(Value::as_str) {
        Some(cmd) if !cmd.is_empty() && cmd.len() <= 64 && cmd.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') => {}
        _ => return Err("study request needs a short cmd".into()),
    }
    for key in object.keys() {
        if FORBIDDEN_REQUEST_KEYS.contains(&key.as_str()) {
            return Err(format!("study request may not set {key}"));
        }
        if key != "cmd" && key != "params" {
            return Err(format!("unexpected study request field {key}"));
        }
    }
    if let Some(params) = object.get("params") {
        let params = params.as_object().ok_or("params must be an object")?;
        for key in params.keys() {
            if FORBIDDEN_REQUEST_KEYS.contains(&key.as_str()) {
                return Err(format!("study params may not set {key}"));
            }
        }
    }
    if request.to_string().len() > MAX_REQUEST_BYTES {
        return Err("study request too large".into());
    }
    Ok(())
}

pub fn run_study(rt: &Runtime, request: &Value) -> Result<Value, String> {
    tick_log("study");
    rt.usable()?;
    validate_study_request(request)?;
    let mut child = rt
        .study_command(&["--json", "run"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn study core: {e}"))?;
    {
        let stdin = child.stdin.as_mut().ok_or("study core stdin unavailable")?;
        stdin
            .write_all(request.to_string().as_bytes())
            .map_err(|e| format!("failed to send study request: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("study core failed: {e}"))?;
    if output.stdout.len() > MAX_REPLY_BYTES {
        return Err("study core reply too large; narrow the request (history is paginated)".into());
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let line = raw
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .ok_or_else(|| {
            // stderr may carry a traceback with response text: log it locally,
            // never hand it to the webview.
            let err = String::from_utf8_lossy(&output.stderr);
            for l in err.lines().rev().take(3) {
                eprintln!("[kairos-daemon] study core: {l}");
            }
            format!("study core produced no reply (exit {})", output.status)
        })?;
    serde_json::from_str(line).map_err(|e| format!("study core JSON parse failed: {e}"))
}

/// Student-owned week plan state (`canvas_mcp/core/week_plan.py`): estimates,
/// hours, deferrals, the accepted plan, captures, pile corrections. Local only.
pub fn run_week_plan(rt: &Runtime, request: &Value) -> Result<Value, String> {
    tick_log("week-plan");
    rt.usable()?;
    validate_study_request(request)?;
    let mut child = rt
        .core_module_command("week_plan", &["--json", "run"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn week plan: {e}"))?;
    {
        let stdin = child.stdin.as_mut().ok_or("week plan stdin unavailable")?;
        stdin
            .write_all(request.to_string().as_bytes())
            .map_err(|e| format!("failed to send week plan request: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("week plan failed: {e}"))?;
    if output.stdout.len() > MAX_REPLY_BYTES {
        return Err("week plan reply too large".into());
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let line = raw
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .ok_or_else(|| {
            let err = String::from_utf8_lossy(&output.stderr);
            for l in err.lines().rev().take(3) {
                eprintln!("[kairos-daemon] week plan: {l}");
            }
            format!("week plan produced no reply (exit {})", output.status)
        })?;
    serde_json::from_str(line).map_err(|e| format!("week plan JSON parse failed: {e}"))
}

fn is_weekend_now() -> bool {
    use std::time::SystemTime;
    // Local weekday via chrono would be nicer; avoid extra dep — use UTC day-of-week
    // approximation sufficient for cadence scaffolding.
    let secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 1970-01-01 was Thursday; days since epoch.
    let days = secs / 86_400;
    let weekday = ((days + 4) % 7) as u8; // 0=Sun .. 6=Sat
    weekday == 0 || weekday == 6
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Rust ↔ Python contract: a real study round trip on a throwaway profile.
    /// Skips (with a note) when the repo venv is absent, e.g. on CI without Python deps.
    #[test]
    fn study_roundtrip_via_python_core() {
        let tmp = std::env::temp_dir().join(format!("pn-study-rt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::env::set_var("DEV_USER_ROOT", &tmp);
        let rt = crate::runtime::resolve(None);
        if !rt.python.is_file() || rt.mode != crate::runtime::RuntimeMode::Dev {
            eprintln!("skipping: no dev python at {}", rt.python.display());
            return;
        }
        let status = run_study(&rt, &serde_json::json!({"cmd": "status"})).expect("status");
        assert_eq!(status["ok"], true);
        assert_eq!(status["items"]["active"], 0);
        let offer = run_study(&rt, &serde_json::json!({"cmd": "offer", "params": {}})).expect("offer");
        assert_eq!(offer["kind"], "missing_source");
        let imported = run_study(&rt, &serde_json::json!({"cmd": "import-template", "params": {"packet_id": "Q"}}))
            .expect("import");
        assert_eq!(imported["ok"], true);
        let offer = run_study(&rt, &serde_json::json!({"cmd": "offer", "params": {}})).expect("offer");
        assert_eq!(offer["kind"], "offer");
        // The public item carries no key before submission.
        assert!(offer["item"].get("key").is_none());
        // Error envelope surfaces as Ok(json) with ok=false, never a panic.
        let bad = run_study(&rt, &serde_json::json!({"cmd": "start", "params": {"item_id": "nope"}})).expect("envelope");
        assert_eq!(bad["ok"], false);
        assert_eq!(bad["error"]["code"], "not_found");
        std::env::remove_var("DEV_USER_ROOT");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn study_requests_cannot_move_the_clock_or_choose_paths() {
        assert!(validate_study_request(&serde_json::json!({"cmd": "status"})).is_ok());
        assert!(validate_study_request(&serde_json::json!({"cmd": "offer", "params": {"minutes": 5}})).is_ok());
        for bad in [
            serde_json::json!({"cmd": "status", "now": "2030-01-01T00:00:00Z"}),
            serde_json::json!({"cmd": "import", "params": {"path": "/etc/passwd"}}),
            serde_json::json!({"cmd": "status", "params": {"user_root": "/tmp/x"}}),
            serde_json::json!({"cmd": "../evil"}),
            serde_json::json!(["status"]),
        ] {
            assert!(validate_study_request(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn freshness_output_parses_last_json_line() {
        assert_eq!(parse_freshness_output("[user-root] x\n{\"ok\":true,\"new_events\":3}\n"), Ok(3));
        assert_eq!(parse_freshness_output("{\"ok\":true}"), Ok(0));
        assert!(parse_freshness_output("{\"ok\":false,\"error\":\"boom\"}").unwrap_err().contains("boom"));
        assert!(parse_freshness_output("no json").is_err());
        assert!(FRESHNESS_TICK >= Duration::from_secs(60));
    }

    #[test]
    fn cadence_respects_floor() {
        assert!(next_sync_interval(false) >= SYNC_FLOOR);
        assert_eq!(next_sync_interval(false), SYNC_WEEKDAY);
        assert_eq!(next_sync_interval(true), SYNC_WEEKEND);
    }
}
