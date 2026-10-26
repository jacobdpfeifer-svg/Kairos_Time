//! Reviewer: the one crash-safe writer for student-owned files under `{user_root}`.
//!
//! Three modules used to carry their own `write_atomic`, and the copies had
//! drifted apart: one scoped the temp file to the process id and one did not
//! (so two writes could clobber each other's temp), one left the temp file
//! behind when the rename failed, and two ignored a failed `chmod` — which
//! would publish a student's calendar or briefs at the umask default instead of
//! `0600`. Writes here fail closed instead: if the private mode cannot be set,
//! the temp file is removed and nothing replaces the target.

use std::fs;
use std::path::Path;

/// Create `path` and its parents, private to the student (`0700` on unix).
pub fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Replace `target` through a temp file and a rename, so a crash or a full disk
/// cannot leave a truncated file behind, and the bytes are never readable by
/// another account on the machine.
pub fn write_atomic(target: &Path, body: &[u8]) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        ensure_dir(parent)?;
    }
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "write target has no file name".to_string())?;
    let tmp = target.with_file_name(format!("{name}.tmp-{}", std::process::id()));
    fs::write(&tmp, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600)) {
            let _ = fs::remove_file(&tmp);
            return Err(e.to_string());
        }
    }
    fs::rename(&tmp, target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::{ensure_dir, write_atomic};

    #[test]
    fn write_atomic_leaves_no_temp_file_and_a_private_mode() {
        let dir = std::env::temp_dir().join(format!("kairos-userfile-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        ensure_dir(&dir).expect("dir");
        let target = dir.join("nested").join("week.json");
        write_atomic(&target, b"{}").expect("write");
        assert_eq!(std::fs::read(&target).expect("read"), b"{}");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&target).expect("stat").permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let strays: Vec<_> = std::fs::read_dir(target.parent().expect("parent"))
            .expect("list")
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(strays.is_empty(), "temp file left behind");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
