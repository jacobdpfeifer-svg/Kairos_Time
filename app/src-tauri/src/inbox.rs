//! Small onboarding writes into `{user_root}` (school slug, keys, opt-ins).
//!
//! The user root itself is resolved once at boot by `runtime::resolve` (profile
//! identity shared with Python/JS); every helper here takes it explicitly.

use std::fs;
use std::path::{Path, PathBuf};

pub fn auth_dir(user_root: &Path) -> PathBuf {
    user_root.join("auth")
}

pub fn save_school_slug(user_root: &Path, slug: &str) -> Result<(), String> {
    fs::create_dir_all(user_root).map_err(|e| e.to_string())?;
    fs::write(user_root.join("school_slug"), slug.trim()).map_err(|e| e.to_string())
}

pub fn save_cloud_key(user_root: &Path, key: &str) -> Result<(), String> {
    let dir = auth_dir(user_root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("cloud_key");
    fs::write(&path, key.trim()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Career / course priorities note from onboarding (plain text).
pub fn save_priorities(user_root: &Path, text: &str) -> Result<(), String> {
    let root = user_root.join("calibration");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    fs::write(root.join("priorities.txt"), text.trim()).map_err(|e| e.to_string())
}

/// Persist Sentry opt-in for the local daemon / telemetry helper.
pub fn save_sentry_opt_in(user_root: &Path, opt_in: bool) -> Result<(), String> {
    let root = user_root.join("calibration");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let value = if opt_in { "1" } else { "0" };
    fs::write(root.join("sentry_opt_in"), value).map_err(|e| e.to_string())
}

/// Waitlist email when the student's school is not yet supported.
pub fn save_waitlist_email(user_root: &Path, email: &str) -> Result<(), String> {
    let root = user_root.join("calibration");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    fs::write(root.join("waitlist_email.txt"), email.trim()).map_err(|e| e.to_string())
}
