//! Student library uploads. The webview sends one file's raw bytes per call
//! (`invoke("library_stage_file", bytes, { headers: { "x-file-name": .. } })`);
//! they land in `{user_root}/inbox/library/incoming/` and the study core's
//! `library-ingest` sorts, extracts and indexes them. Bytes never pass through
//! the 256 KB JSON study bridge, and nothing here reads a path the webview names.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::State;

use crate::runtime::Runtime;

/// Matches `MAX_FILE_BYTES` in `study/library.py`.
const MAX_UPLOAD_BYTES: usize = 50 * 1024 * 1024;
static SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
pub struct Staged {
    pub name: String,
    pub bytes: usize,
}

#[tauri::command]
pub fn library_stage_file(rt: State<'_, Arc<Runtime>>, request: Request<'_>) -> Result<Staged, String> {
    rt.usable()?;
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_default();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    stage(&rt.user_root, &name, bytes)
}

fn incoming_dir(user_root: &Path) -> PathBuf {
    user_root.join("inbox").join("library").join("incoming")
}

pub fn stage(user_root: &Path, raw_name: &str, bytes: &[u8]) -> Result<Staged, String> {
    let name = safe_name(raw_name);
    if bytes.is_empty() {
        return Err(format!("{name} is empty"));
    }
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(format!("{name} is larger than {} MB", MAX_UPLOAD_BYTES / (1024 * 1024)));
    }
    let dir = incoming_dir(user_root);
    fs::create_dir_all(&dir).map_err(|e| format!("could not create the library folder: {e}"))?;
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    // `library-ingest` recovers the original name after the first "--".
    let staged = format!("{millis}-{seq}--{name}");
    let tmp = dir.join(format!(".{staged}.part"));
    fs::write(&tmp, bytes).map_err(|e| format!("could not save {name}: {e}"))?;
    fs::rename(&tmp, dir.join(&staged)).map_err(|e| format!("could not save {name}: {e}"))?;
    Ok(Staged { name, bytes: bytes.len() })
}

fn safe_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .trim_start_matches('.')
        .chars()
        .take(180)
        .collect();
    if cleaned.is_empty() { "file".into() } else { cleaned }
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| (b as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_decoded_and_cannot_escape_the_folder() {
        assert_eq!(percent_decode("Week%203%20notes.pdf"), "Week 3 notes.pdf");
        assert_eq!(percent_decode("caf%C3%A9.md"), "café.md");
        assert_eq!(percent_decode("bad%2"), "bad%2");
        assert_eq!(percent_decode("%é"), "%é");
        assert_eq!(safe_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_name("..\\x\\.hidden"), "hidden");
        assert_eq!(safe_name("   "), "file");
    }

    #[test]
    fn stage_writes_into_incoming_and_rejects_empty_files() {
        let root = std::env::temp_dir().join(format!("kairos-lib-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let staged = stage(&root, "notes.md", b"chain rule").expect("staged");
        assert_eq!(staged.name, "notes.md");
        let files: Vec<_> = fs::read_dir(incoming_dir(&root)).unwrap().flatten().collect();
        assert_eq!(files.len(), 1);
        assert!(files[0].file_name().to_string_lossy().ends_with("--notes.md"));
        assert!(stage(&root, "empty.txt", b"").is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
