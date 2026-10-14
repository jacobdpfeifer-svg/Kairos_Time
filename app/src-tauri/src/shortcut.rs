//! Global capture shortcut (opt-in, Settings → Shortcuts). Pressing it brings
//! the workspace forward with ⌘K open on the capture line. Off until the
//! student picks a combination, so it never takes a key another app uses.

use tauri::{AppHandle, Emitter, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub fn plugin() -> tauri::plugin::TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if let Err(e) = crate::dock::show_workspace(app) {
                    eprintln!("[kairos] capture shortcut: {e}");
                }
                let _ = app.emit("deep-link", "kairos://capture");
            }
        })
        .build()
}

/// Replace whatever shortcut is registered with `raw` (or none).
pub fn apply(app: &AppHandle, raw: Option<&str>) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    if let Some(raw) = raw.filter(|s| !s.trim().is_empty()) {
        if !crate::prefs::valid_shortcut(raw) {
            return Err("That shortcut needs at least one modifier and one key.".into());
        }
        let shortcut: Shortcut = raw
            .parse()
            .map_err(|e| format!("Kairos can't use that shortcut: {e}"))?;
        gs.register(shortcut)
            .map_err(|e| format!("Another app already uses that shortcut: {e}"))?;
    }
    Ok(())
}
