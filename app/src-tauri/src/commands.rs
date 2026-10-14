//! Tauri commands bridging the React shell to daemon sync + inbox + onboarding.

use crate::calendar;
use crate::advisor;
use crate::canvas;
use crate::daemon;
use crate::inbox;
use crate::runtime::{self, Runtime};
use crate::prefs;
use crate::semester;
use serde::Serialize;
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, State};

type Rt<'a> = State<'a, Arc<Runtime>>;

#[derive(Debug, Serialize)]
pub struct SyncResult {
    pub ok: bool,
    pub error: Option<String>,
}

fn emit_inbox_updated(app: &AppHandle) {
    let _ = app.emit("inbox-updated", ());
}

/// Run blocking work (Python, Node, network) off the main thread. Non-async
/// Tauri commands run on the main thread, so a sync there froze the window.
async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| format!("background task failed: {e}"))?
}

/// Run Canvas sync (same helper as the tray menu) and notify the UI.
#[tauri::command]
pub async fn sync_canvas(app: AppHandle, rt: Rt<'_>) -> Result<SyncResult, String> {
    let rt = Arc::clone(&rt);
    let result = blocking(move || Ok(daemon::run_canvas_sync(&rt))).await?;
    match result {
        Ok(()) => {
            emit_inbox_updated(&app);
            Ok(SyncResult {
                ok: true,
                error: None,
            })
        }
        Err(e) => Ok(SyncResult {
            ok: false,
            error: Some(e),
        }),
    }
}

/// Export the last canonical Canvas snapshot. Grades are excluded unless the
/// student explicitly opts in for this action.
#[tauri::command]
pub async fn export_canvas(rt: Rt<'_>, include_grades: Option<bool>) -> Result<serde_json::Value, String> {
    let rt = Arc::clone(&rt);
    let raw = blocking(move || daemon::run_canvas_export(&rt, include_grades.unwrap_or(false))).await?;
    serde_json::from_str(&raw).map_err(|e| format!("invalid export result: {e}"))
}

#[tauri::command]
pub async fn open_canvas_sso(rt: Rt<'_>) -> Result<(), String> {
    let rt = Arc::clone(&rt);
    blocking(move || daemon::run_open_canvas(&rt)).await
}

/// Headless probe: is there already a valid Canvas session in browser/.auth?
/// Onboarding calls this before showing the sign-in step.
#[tauri::command]
pub async fn check_canvas_session(rt: Rt<'_>) -> Result<bool, String> {
    let rt = Arc::clone(&rt);
    blocking(move || daemon::run_check_canvas_session(&rt)).await
}

/// Find the student's school by name (public Instructure account search).
#[tauri::command]
pub async fn search_schools(rt: Rt<'_>, term: String) -> Result<serde_json::Value, String> {
    let term = term.trim().to_string();
    if term.chars().count() < 2 {
        return Ok(serde_json::json!({ "schools": [] }));
    }
    let rt = Arc::clone(&rt);
    let parsed = blocking(move || daemon::run_school_script(&rt, &["search", &term])).await?;
    Ok(parsed.get("schools").cloned().unwrap_or(serde_json::json!([])))
}

/// Save the school the student picked (or the Canvas address they pasted) to
/// `{user_root}/school/profile.json`; every later SSO/sync shell reads it.
#[tauri::command]
pub fn choose_school(
    rt: Rt<'_>,
    host: String,
    name: String,
    account_id: Option<i64>,
    manual: Option<bool>,
) -> Result<serde_json::Value, String> {
    let account = account_id.map(|n| n.to_string());
    let mut args: Vec<&str> = vec!["choose", "--host", host.trim(), "--name", name.trim()];
    if let Some(a) = account.as_deref() {
        args.extend(["--account-id", a]);
    }
    if manual.unwrap_or(false) {
        args.extend(["--source", "manual"]);
    }
    let parsed = daemon::run_school_script(&rt, &args)?;
    let profile = parsed.get("profile").cloned().unwrap_or(serde_json::Value::Null);
    if let Some(slug) = profile.get("slug").and_then(|v| v.as_str()) {
        inbox::save_school_slug(&rt.user_root, slug)?;
        std::env::set_var("SCHOOL_SLUG", slug);
    }
    Ok(profile)
}

/// The school saved at onboarding (`{user_root}/school/profile.json`), or null.
#[tauri::command]
pub fn read_school_profile(rt: Rt<'_>) -> Result<serde_json::Value, String> {
    let path = rt.user_root.join("school").join("profile.json");
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("bad school profile: {e}")),
        Err(_) => Ok(serde_json::Value::Null),
    }
}

#[tauri::command]
pub fn save_onboarding(
    rt: Rt<'_>,
    school_slug: String,
    cloud_key: String,
    priorities: Option<String>,
    sentry_opt_in: Option<bool>,
    waitlist_email: Option<String>,
) -> Result<(), String> {
    if school_slug.trim().is_empty() {
        return Err("school slug is required".into());
    }
    let slug = school_slug.trim();
    if slug == "waitlist" {
        let email = waitlist_email.as_deref().unwrap_or("").trim();
        if email.is_empty() {
            return Err("waitlist email is required when your school is not listed".into());
        }
        inbox::save_waitlist_email(&rt.user_root, email)?;
        inbox::save_school_slug(&rt.user_root, "waitlist")?;
        if let Some(opt_in) = sentry_opt_in {
            inbox::save_sentry_opt_in(&rt.user_root, opt_in)?;
        }
        return Ok(());
    }
    inbox::save_school_slug(&rt.user_root, slug)?;
    // Cloud key is optional. A blank key stores nothing — there is no local-model path.
    if !cloud_key.trim().is_empty() {
        inbox::save_cloud_key(&rt.user_root, &cloud_key)?;
    }
    if let Some(text) = priorities.as_deref() {
        if !text.trim().is_empty() {
            inbox::save_priorities(&rt.user_root, text)?;
        }
    }
    if let Some(opt_in) = sentry_opt_in {
        inbox::save_sentry_opt_in(&rt.user_root, opt_in)?;
    }
    // Honor school for subsequent sync shells in this process.
    std::env::set_var("SCHOOL_SLUG", slug);
    Ok(())
}

/// Save the onboarding learning-profile games' answers (see docs/design/learning-profile.md).
#[tauri::command]
pub fn save_learning_profile(
    rt: Rt<'_>,
    practice_format: String,
    autonomy: String,
    chunk_size: String,
    check_depth: String,
    if_then: Option<String>,
) -> Result<(), String> {
    daemon::run_save_learning_profile(
        &rt,
        &practice_format,
        &autonomy,
        &chunk_size,
        &check_depth,
        if_then.as_deref().unwrap_or(""),
    )
}

/// Due retrieval checks (at most two). Does not invent cards from the week list.
#[tauri::command]
pub fn read_due_reviews(rt: Rt<'_>) -> Result<serde_json::Value, String> {
    daemon::run_due_reviews(&rt)
}

/// Student-scored retrieval. Dock checks of scheduled items pass same_session=false.
#[tauri::command]
pub fn record_review_outcome(
    rt: Rt<'_>,
    item_id: String,
    outcome: String,
    same_session: Option<bool>,
) -> Result<serde_json::Value, String> {
    daemon::run_record_review_outcome(&rt, &item_id, &outcome, same_session.unwrap_or(false))
}

/// Study workspace bridge. `request` = {"cmd": .., "params": {..}}; the reply is
/// the Python study CLI's envelope ({"ok": true, ..} or {"ok": false, "error": ..}).
#[tauri::command]
pub async fn study(rt: Rt<'_>, request: serde_json::Value) -> Result<serde_json::Value, String> {
    daemon::validate_study_request(&request)?;
    let rt = Arc::clone(&rt);
    blocking(move || daemon::run_study(&rt, &request)).await
}

/// Week plan state: `{ cmd, params }` like `study`, handled by `week_plan.py`.
#[tauri::command]
pub async fn week_plan(rt: Rt<'_>, request: serde_json::Value) -> Result<serde_json::Value, String> {
    daemon::validate_study_request(&request)?;
    let rt = Arc::clone(&rt);
    blocking(move || daemon::run_week_plan(&rt, &request)).await
}

/// Whether the Chrome extension has reached this app, and when.
#[tauri::command]
pub fn extension_status(rt: Rt<'_>) -> serde_json::Value {
    serde_json::json!({ "connected_at": crate::nativehost::connected_at(&rt.user_root) })
}

/// Native opt-ins (keep running, notifications, capture shortcut). All default off.
#[tauri::command]
pub fn read_app_prefs(rt: Rt<'_>) -> prefs::AppPrefs {
    prefs::read(&rt.user_root)
}

/// Save the opt-ins and apply the capture shortcut right away.
#[tauri::command]
pub fn set_app_prefs(app: AppHandle, rt: Rt<'_>, prefs: prefs::AppPrefs) -> Result<prefs::AppPrefs, String> {
    prefs::write(&rt.user_root, &prefs)?;
    crate::shortcut::apply(&app, prefs.capture_shortcut.as_deref())?;
    Ok(prefs)
}

/// Sync Canvas study sources. Emits `study-sync-progress` as progress.json updates.
#[tauri::command]
pub async fn sync_study_sources(app: AppHandle, rt: Rt<'_>) -> Result<SyncResult, String> {
    let handle = app.clone();
    let rt = Arc::clone(&rt);
    let root = rt.user_root.clone();
    let watch_root = root.clone();
    let watcher = thread::spawn(move || {
        let mut last = String::new();
        for _ in 0..600 {
            let payload = semester::read_sync_progress(&watch_root);
            let serialized = payload.to_string();
            if serialized != last {
                last.clone_from(&serialized);
                let _ = handle.emit("study-sync-progress", payload);
            }
            let phase = serde_json::from_str::<serde_json::Value>(&last)
                .ok()
                .and_then(|v| v.get("phase").and_then(|p| p.as_str()).map(str::to_string));
            if matches!(phase.as_deref(), Some("done") | Some("failed")) {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(80));
        }
    });
    let result = blocking(move || Ok(daemon::run_sync_study_sources(&rt))).await?;
    let _ = blocking(move || watcher.join().map_err(|_| "progress watcher panicked".to_string())).await;
    let _ = app.emit("study-sync-progress", semester::read_sync_progress(&root));
    Ok(match result {
        Ok(()) => SyncResult {
            ok: true,
            error: None,
        },
        Err(e) => SyncResult {
            ok: false,
            error: Some(e),
        },
    })
}

#[tauri::command]
pub fn read_semester(
    rt: Rt<'_>,
    range: String,
    today: String,
) -> Result<semester::SemesterSurface, String> {
    let today = if today.is_empty() {
        "2026-09-20T00:00:00Z".into()
    } else {
        today
    };
    semester::read_semester(&rt.user_root, &range, &today)
}

#[tauri::command]
pub fn read_sync_progress(rt: Rt<'_>) -> serde_json::Value {
    semester::read_sync_progress(&rt.user_root)
}

#[tauri::command]
pub fn read_calendar_surface(rt: Rt<'_>) -> Result<serde_json::Value, String> {
    let commitment = daemon::run_read_commitment(&rt).unwrap_or_else(|_| {
        serde_json::json!({ "commitment": null, "check_in": null, "line": "" })
    });
    Ok(serde_json::json!({
        "events": calendar::read_events(&rt.user_root),
        "canvas_events": canvas::canvas_calendar_items(&rt.user_root),
        "suggestions": calendar::read_suggestions(&rt.user_root),
        "commitment": commitment,
        "sync_health": canvas::read_sync_health(&rt.user_root),
    }))
}

#[tauri::command]
pub fn read_sync_health(rt: Rt<'_>) -> serde_json::Value {
    canvas::read_sync_health(&rt.user_root)
}

#[tauri::command]
pub fn read_freshness(rt: Rt<'_>) -> serde_json::Value {
    canvas::read_freshness(&rt.user_root)
}

#[tauri::command]
pub fn read_skip_costs(rt: Rt<'_>) -> serde_json::Value {
    canvas::read_skip_costs(&rt.user_root)
}

#[tauri::command]
pub fn read_advisor_snapshot(rt: Rt<'_>) -> serde_json::Value {
    advisor::read_snapshot(&rt.user_root)
}

#[tauri::command]
pub fn read_course_colors(rt: Rt<'_>) -> serde_json::Value {
    canvas::read_course_colors(&rt.user_root)
}

#[tauri::command]
pub fn read_course_map(rt: Rt<'_>, course_id: String) -> serde_json::Value {
    canvas::read_course_map(&rt.user_root, &course_id)
}

#[tauri::command]
pub fn read_grade_truth(rt: Rt<'_>, course_id: String) -> serde_json::Value {
    canvas::read_grade_truth(&rt.user_root, &course_id)
}

#[tauri::command]
pub fn add_calendar_event(
    rt: Rt<'_>,
    event: calendar::CalendarEvent,
) -> Result<calendar::CalendarEvent, String> {
    calendar::append_event(&rt.user_root, event)
}

#[tauri::command]
pub fn dismiss_calendar_suggestion(rt: Rt<'_>, source_message_id: String) -> Result<(), String> {
    calendar::dismiss_suggestion(&rt.user_root, &source_message_id)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) URLs can be opened".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = url;
        Err("open_external_url is macOS-only in this build".into())
    }
}

/// Runtime summary for Settings / first-run diagnostics (no secrets).
#[tauri::command]
pub fn runtime_info(rt: Rt<'_>) -> serde_json::Value {
    rt.summary()
}

/// Switch the active profile. Takes effect on the next launch: every child
/// process of THIS run already carries the boot-time identity.
#[tauri::command]
pub fn set_profile(app: AppHandle, profile_id: String) -> Result<serde_json::Value, String> {
    runtime::set_current_profile(&profile_id)?;
    let _ = app.emit("profile-changed", profile_id.clone());
    Ok(serde_json::json!({"ok": true, "profile_id": profile_id, "restart_required": true}))
}

/// List profiles that exist under the app-support root (directory names only).
#[tauri::command]
pub fn list_profiles(rt: Rt<'_>) -> serde_json::Value {
    let root = runtime::app_support_root();
    let mut ids: Vec<String> = std::fs::read_dir(&root)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|name| runtime::valid_profile_id(name))
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    serde_json::json!({"current": rt.profile_id, "profiles": ids, "root": root.display().to_string()})
}
