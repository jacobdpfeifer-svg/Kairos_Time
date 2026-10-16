//! Small onboarding writes into `{user_root}` (the chosen school).
//!
//! The user root itself is resolved once at boot by `runtime::resolve` (profile
//! identity shared with Python/JS); every helper here takes it explicitly.

use std::fs;
use std::path::Path;

/// School slugs are file stems under `schools/` (`cu-boulder`, `canvas-colorado-edu`).
/// Python and Node load `schools/{slug}.yaml`, so a slug must never carry a path.
pub fn valid_school_slug(slug: &str) -> bool {
    let mut chars = slug.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphanumeric() || c == '_')
        && slug.len() <= 128
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn save_school_slug(user_root: &Path, slug: &str) -> Result<(), String> {
    let slug = slug.trim();
    if !valid_school_slug(slug) {
        return Err("invalid school slug".into());
    }
    fs::create_dir_all(user_root).map_err(|e| e.to_string())?;
    fs::write(user_root.join("school_slug"), slug).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::valid_school_slug;

    #[test]
    fn school_slugs_cannot_name_a_path() {
        assert!(valid_school_slug("cu-boulder"));
        assert!(valid_school_slug("canvas-colorado-edu"));
        for bad in ["", "../x", "a/b", "..", "-flag", "x y", "a\\b"] {
            assert!(!valid_school_slug(bad), "{bad}");
        }
    }
}
