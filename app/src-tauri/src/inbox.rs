//! Small onboarding writes into `{user_root}` (the chosen school).
//!
//! The user root itself is resolved once at boot by `runtime::resolve` (profile
//! identity shared with Python/JS); every helper here takes it explicitly.

use std::fs;
use std::path::Path;

pub fn save_school_slug(user_root: &Path, slug: &str) -> Result<(), String> {
    fs::create_dir_all(user_root).map_err(|e| e.to_string())?;
    fs::write(user_root.join("school_slug"), slug.trim()).map_err(|e| e.to_string())
}
