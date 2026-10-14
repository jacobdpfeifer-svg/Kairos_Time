// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod calendar;
mod advisor;
mod canvas;
mod commands;
mod daemon;
mod dock;
mod inbox;
mod library;
mod nativehost;
mod prefs;
mod runtime;
mod semester;
mod shortcut;

use std::sync::{Arc, Mutex};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Listener, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;

/// A `kairos://` link that arrived before the webview was listening (cold
/// start from a notification, the extension, or a link). Today takes it once.
#[derive(Default)]
struct PendingLink(Mutex<Option<String>>);

#[tauri::command]
fn take_pending_link(state: tauri::State<'_, PendingLink>) -> Option<String> {
    state.0.lock().ok().and_then(|mut slot| slot.take())
}

fn open_link(app: &tauri::AppHandle, url: &str) {
    if !url.to_ascii_lowercase().starts_with("kairos://") {
        return;
    }
    if let Some(state) = app.try_state::<PendingLink>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = Some(url.to_string());
        }
    }
    let _ = dock::show_workspace(app);
    let _ = app.emit("deep-link", url);
}

fn main() {
    daemon::tick_log("boot");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(shortcut::plugin())
        .manage(PendingLink::default())
        .on_window_event(|window, event| {
            // Opt-in: closing the window keeps Kairos in the menu bar and syncing.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == dock::MAIN_WINDOW {
                    let keep = window
                        .try_state::<Arc<runtime::Runtime>>()
                        .map(|rt| prefs::read(&rt.user_root).keep_running)
                        .unwrap_or(false);
                    if keep {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_link,
            dock::set_dock_mode,
            commands::sync_canvas,
            commands::export_canvas,
            commands::open_canvas_sso,
            commands::check_canvas_session,
            commands::search_schools,
            commands::choose_school,
            commands::read_school_profile,
            commands::save_onboarding,
            commands::save_learning_profile,
            commands::read_due_reviews,
            commands::record_review_outcome,
            commands::study,
            library::library_stage_file,
            commands::sync_study_sources,
            commands::read_semester,
            commands::read_sync_progress,
            commands::read_calendar_surface,
            commands::read_sync_health,
            commands::read_freshness,
            commands::read_skip_costs,
            commands::week_plan,
            commands::read_app_prefs,
            commands::extension_status,
            commands::set_app_prefs,
            commands::read_advisor_snapshot,
            commands::read_course_map,
            commands::read_course_colors,
            commands::read_grade_truth,
            commands::add_calendar_event,
            commands::dismiss_calendar_suggestion,
            commands::open_external_url,
            commands::runtime_info,
            commands::set_profile,
            commands::list_profiles,
        ])
        .setup(|app| {
            // Resolve bundled resources vs dev checkout once; share with every command.
            // Some launch contexts do not give Tauri a usable resource path even
            // though the app is inside a valid .app bundle. Validate the path and
            // recover from the executable location before allowing the dev
            // checkout fallback.
            let resource_dir = app
                .path()
                .resource_dir()
                .ok()
                .filter(|dir| dir.join("core").is_dir())
                .or_else(|| {
                    std::env::current_exe()
                        .ok()
                        .and_then(|exe| exe.parent()?.parent().map(|contents| contents.join("Resources")))
                        .filter(|dir| dir.join("core").is_dir())
                });
            let rt = Arc::new(runtime::resolve(resource_dir.as_deref()));
            for note in &rt.diagnostics {
                eprintln!("[kairos-daemon] runtime: {note}");
            }
            eprintln!(
                "[kairos-daemon] runtime {:?} profile={} root={}",
                rt.mode,
                rt.profile_id,
                rt.user_root.display()
            );
            app.manage(Arc::clone(&rt));

            // kairos:// links: from the Chrome extension, notifications, or anywhere on the Mac.
            let link_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    open_link(&link_handle, url.as_str());
                }
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                if let Some(url) = urls.first() {
                    open_link(app.handle(), url.as_str());
                }
            }

            // Let the Chrome extension reach this app (replaces the developer install script).
            let host_rt = Arc::clone(&rt);
            std::thread::spawn(move || {
                if host_rt.usable().is_ok() {
                    if let Err(e) = nativehost::install(&host_rt) {
                        eprintln!("[kairos-daemon] native host install: {e}");
                    }
                }
            });

            // The opt-in capture shortcut, if the student chose one.
            if let Some(raw) = prefs::read(&rt.user_root).capture_shortcut {
                if let Err(e) = shortcut::apply(app.handle(), Some(&raw)) {
                    eprintln!("[kairos-daemon] capture shortcut: {e}");
                }
            }

            let sync_now = MenuItem::with_id(app, "sync_now", "Sync now", true, None::<&str>)?;
            let next = MenuItem::with_id(app, "next", "Next: Open Today", true, None::<&str>)?;
            let next_label = next.clone();
            let capture = MenuItem::with_id(app, "capture", "Capture…", true, None::<&str>)?;
            let open_today = MenuItem::with_id(app, "open_today", "Open Today", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&next, &open_today, &capture, &sync_now, &quit])?;

            // Today sends the focus title. Until one arrives, Next opens Today.
            app.listen("tray-next", move |event| {
                let raw = serde_json::from_str::<String>(event.payload()).unwrap_or_default();
                let title: String = raw.chars().filter(|c| !c.is_control()).take(48).collect();
                let label = if title.trim().is_empty() {
                    "Next: Open Today".to_string()
                } else {
                    format!("Next: {}", title.trim())
                };
                let _ = next_label.set_text(label);
            });

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Kairos (private beta)")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "next" | "open_today" => open_link(app, "kairos://today"),
                    "capture" => open_link(app, "kairos://capture"),
                    "sync_now" => {
                        // Same helper the sync_canvas command uses, off the menu thread.
                        let handle = app.clone();
                        let rt = handle.state::<Arc<runtime::Runtime>>().inner().clone();
                        std::thread::spawn(move || match daemon::run_canvas_sync(rt.as_ref()) {
                            Ok(()) => {
                                let _ = handle.emit("inbox-updated", ());
                            }
                            Err(e) => {
                                eprintln!("[kairos-daemon] Sync now failed: {e}");
                                let _ = handle.emit("sync-failed", e);
                            }
                        });
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Err(e) = dock::toggle(app) {
                            eprintln!("[kairos-daemon] dock toggle failed: {e}");
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }

            let _tray = tray.build(app)?;

            // The main window is the study workspace (normal, resizable). The
            // compact dock geometry is opt-in from the frontend (set_dock_mode).
            daemon::spawn_cadence_loop(Arc::clone(&rt));
            let handle = app.handle().clone();
            daemon::spawn_freshness_loop(Arc::clone(&rt), move |n| {
                let _ = handle.emit("freshness-updated", n);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Kairos");

    app.run(|handle, event| {
        // Clicking the Dock icon while the window is hidden brings it back.
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            let _ = dock::show_workspace(handle);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (handle, event);
    });
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    fn between<'a>(src: &'a str, start: &str, end: &str) -> &'a str {
        let from = src.find(start).expect("start marker") + start.len();
        let len = src[from..].find(end).expect("end marker");
        &src[from..from + len]
    }

    /// With an AppManifest command list, Tauri's app ACL rejects any invoke
    /// that has no `allow-*` permission, so every registered handler must be
    /// listed in build.rs and granted by the default capability.
    #[test]
    fn every_handler_is_in_app_manifest_and_capability() {
        let handlers: BTreeSet<String> =
            between(include_str!("main.rs"), "generate_handler![", "])")
                .split(',')
                .map(|s| s.trim().rsplit("::").next().unwrap().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        let manifest: BTreeSet<String> =
            between(include_str!("../build.rs"), ".commands(&[", "])")
                .split(',')
                .map(|s| s.trim().trim_matches('"').to_string())
                .filter(|s| !s.is_empty())
                .collect();
        let cap: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let allowed: BTreeSet<String> = cap["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str())
            .filter_map(|p| p.strip_prefix("allow-"))
            .map(|p| p.replace('-', "_"))
            .collect();

        let missing_manifest: Vec<_> = handlers.difference(&manifest).collect();
        let missing_cap: Vec<_> = handlers.difference(&allowed).collect();
        assert!(missing_manifest.is_empty(), "not in build.rs: {missing_manifest:?}");
        assert!(missing_cap.is_empty(), "not in capabilities/default.json: {missing_cap:?}");
    }
}
