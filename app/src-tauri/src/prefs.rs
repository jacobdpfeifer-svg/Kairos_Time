//! Native opt-ins the student turns on in Settings (approved 2026-10-13):
//! keep running in the menu bar after the window closes, macOS notifications,
//! and a global capture shortcut. All default off. Stored per profile in
//! `{user_root}/calibration/app-prefs.json` so the window-close handler can
//! read them without the webview.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AppPrefs {
    /// Closing the window hides it; the menu bar icon and syncing keep going.
    pub keep_running: bool,
    /// Rare macOS notifications (due date moved, high-stakes work soon, sync broken).
    pub notifications: bool,
    /// Global capture shortcut, e.g. "Control+Alt+Space". None = off.
    pub capture_shortcut: Option<String>,
}

pub fn path(user_root: &Path) -> PathBuf {
    user_root.join("calibration").join("app-prefs.json")
}

/// Missing or unreadable prefs read as all-off.
pub fn read(user_root: &Path) -> AppPrefs {
    fs::read_to_string(path(user_root))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Accept only shortcuts made of modifier names and one plain key, so a stored
/// value can never be anything but a key combination.
pub fn valid_shortcut(raw: &str) -> bool {
    let parts: Vec<&str> = raw.split('+').collect();
    if parts.len() < 2 || parts.len() > 4 || raw.len() > 48 {
        return false;
    }
    let (key, mods) = parts.split_last().unwrap();
    let mods_ok = mods.iter().all(|m| {
        matches!(
            *m,
            "Control"
                | "Ctrl"
                | "Alt"
                | "Option"
                | "Shift"
                | "Command"
                | "Cmd"
                | "Super"
                | "CommandOrControl"
        )
    });
    let key_ok =
        !key.is_empty() && key.len() <= 10 && key.chars().all(|c| c.is_ascii_alphanumeric());
    mods_ok && key_ok
}

pub fn write(user_root: &Path, prefs: &AppPrefs) -> Result<(), String> {
    if let Some(s) = &prefs.capture_shortcut {
        if !valid_shortcut(s) {
            return Err("That shortcut needs at least one modifier and one key.".into());
        }
    }
    let target = path(user_root);
    if let Some(dir) = target.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = target.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    fs::write(&tmp, body).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &target).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_prefs_are_all_off_and_round_trip() {
        let root = std::env::temp_dir().join(format!("kairos-prefs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        assert_eq!(read(&root), AppPrefs::default());
        let prefs = AppPrefs {
            keep_running: true,
            notifications: true,
            capture_shortcut: Some("Control+Alt+Space".into()),
        };
        write(&root, &prefs).unwrap();
        assert_eq!(read(&root), prefs);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn only_modifier_plus_key_shortcuts_are_stored() {
        assert!(valid_shortcut("Control+Alt+Space"));
        assert!(valid_shortcut("CommandOrControl+Shift+K"));
        assert!(!valid_shortcut("K"));
        assert!(!valid_shortcut("Control+rm -rf"));
        assert!(!valid_shortcut("Banana+K"));
    }
}
