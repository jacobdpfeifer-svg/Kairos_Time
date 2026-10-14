//! Installs the Chrome Native Messaging host so the Kairos extension can talk
//! to this app without the developer script (`app/native-messaging/install-macos.sh`).
//!
//! The stdlib-only `host.py` is copied out of the bundle into
//! `~/Library/Application Support/Kairos/native-host/` (Chrome-launched
//! processes can't read iCloud or other protected folders), a launcher runs it
//! with the app's bundled Python instead of the system `python3` stub, and the
//! manifest is written for each Chromium-family browser that is installed.
//! Idempotent: files are rewritten only when their content changes.

use crate::runtime::{app_support_root, Runtime, RuntimeMode};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

pub const HOST_NAME: &str = "com.kairosstudy.daemon";
/// The extension's pinned ID (manifest `key`).
pub const EXTENSION_ID: &str = "jkjkbgcbpakeenemjgkfohbcfbghmall";

fn host_source(rt: &Runtime) -> Option<PathBuf> {
    [
        rt.core_dir.join("native-messaging").join("host.py"),
        rt.core_dir
            .join("app")
            .join("native-messaging")
            .join("host.py"),
    ]
    .into_iter()
    .find(|p| p.is_file())
}

/// The bundled interpreter when installed; the system one in a dev checkout
/// (a repo venv inside iCloud Drive is unreadable to Chrome).
fn interpreter(rt: &Runtime) -> PathBuf {
    if rt.mode == RuntimeMode::Bundled && rt.python.is_file() {
        rt.python.clone()
    } else {
        PathBuf::from("/usr/bin/python3")
    }
}

fn write_if_changed(path: &Path, body: &str) -> Result<bool, String> {
    if fs::read_to_string(path).ok().as_deref() == Some(body) {
        return Ok(false);
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(path, body).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.display().to_string().replace('\'', "'\\''"))
}

/// Browser folders that hold NativeMessagingHosts, relative to `~/Library/Application Support`.
const BROWSERS: &[&str] = &[
    "Google/Chrome",
    "Google/Chrome Beta",
    "Google/Chrome Canary",
    "Chromium",
    "BraveSoftware/Brave-Browser",
    "Microsoft Edge",
    "Arc/User Data",
];

/// Install or refresh the host. Returns the manifest paths written or already current.
pub fn install(rt: &Runtime) -> Result<Vec<PathBuf>, String> {
    if !cfg!(target_os = "macos") {
        return Ok(Vec::new());
    }
    let source = host_source(rt).ok_or("the native host script isn't in this build")?;
    let host_dir = app_support_root().join("native-host");
    let host_py = host_dir.join("host.py");
    let script = fs::read_to_string(&source).map_err(|e| e.to_string())?;
    write_if_changed(&host_py, &script)?;
    make_executable(&host_py)?;

    let launcher = host_dir.join("kairos-native-host");
    let body = format!(
        "#!/bin/sh\n# Written by Kairos. Runs the extension's native host with the app's Python.\nexec {} -I {} \"$@\"\n",
        shell_quote(&interpreter(rt)),
        shell_quote(&host_py)
    );
    write_if_changed(&launcher, &body)?;
    make_executable(&launcher)?;

    let manifest = serde_json::to_string_pretty(&json!({
        "name": HOST_NAME,
        "description": "Kairos Canvas companion (Chrome Native Messaging)",
        "path": launcher.display().to_string(),
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{EXTENSION_ID}/")],
    }))
    .map_err(|e| e.to_string())?
        + "\n";

    let support = app_support_root()
        .parent()
        .map(Path::to_path_buf)
        .ok_or("no Application Support folder")?;
    let mut written = Vec::new();
    for (i, browser) in BROWSERS.iter().enumerate() {
        let base = support.join(browser);
        // Chrome always gets the manifest; others only when the browser is installed.
        if i != 0 && !base.is_dir() {
            continue;
        }
        let path = base
            .join("NativeMessagingHosts")
            .join(format!("{HOST_NAME}.json"));
        write_if_changed(&path, &manifest)?;
        written.push(path);
    }
    Ok(written)
}

/// When the extension last reached the host (`native_host_first_ping` in funnel.json), if ever.
pub fn connected_at(user_root: &Path) -> Option<String> {
    let raw = fs::read_to_string(
        user_root
            .join("inbox")
            .join("freshness")
            .join("funnel.json"),
    )
    .ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value
        .get("native_host_first_ping")?
        .as_str()
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launcher_paths_are_shell_quoted() {
        assert_eq!(shell_quote(Path::new("/A B/it's")), "'/A B/it'\\''s'");
    }

    #[test]
    fn reads_the_first_ping_marker() {
        let root = std::env::temp_dir().join(format!("kairos-host-{}", std::process::id()));
        let dir = root.join("inbox").join("freshness");
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(connected_at(&root), None);
        fs::write(
            dir.join("funnel.json"),
            r#"{"native_host_first_ping":"2026-10-13T10:00:00Z"}"#,
        )
        .unwrap();
        assert_eq!(connected_at(&root).as_deref(), Some("2026-10-13T10:00:00Z"));
        let _ = fs::remove_dir_all(&root);
    }
}
