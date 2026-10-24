//! Per-profile first-run lifecycle, deliberately separate from Canvas health.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA_VERSION: u8 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    School,
    Canvas,
    Workspace,
    Ready,
}

impl Phase {
    /// First run only ever moves forward. A re-sync or a school change must not
    /// drag a student who reached the workspace step back to the Canvas step.
    fn rank(self) -> u8 {
        match self {
            Phase::School => 0,
            Phase::Canvas => 1,
            Phase::Workspace => 2,
            Phase::Ready => 3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct State {
    pub schema_version: u8,
    pub phase: Phase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

impl Default for State {
    fn default() -> Self {
        Self { schema_version: SCHEMA_VERSION, phase: Phase::School, completed_at: None }
    }
}

fn path(root: &Path) -> PathBuf {
    root.join("profile").join("setup.json")
}

/// Proleptic Gregorian date from a day number, after Howard Hinnant. The crate
/// carries no date dependency, so every durable timestamp is built here.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as i64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (y + i64::from(m <= 2), m, d)
}

/// RFC 3339 in UTC, matching every other durable timestamp in the product.
fn iso_from_epoch(secs: u64) -> String {
    let secs = secs as i64;
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn now_iso() -> String {
    iso_from_epoch(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs())
}

fn write(root: &Path, state: &State) -> Result<(), String> {
    let target = path(root);
    let dir = target.parent().ok_or_else(|| "setup path".to_string())?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let tmp = target.with_file_name(format!("setup.json.tmp-{}", std::process::id()));
    fs::write(&tmp, serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, target).map_err(|e| e.to_string())
}

pub fn read(root: &Path) -> State {
    let Ok(raw) = fs::read_to_string(path(root)) else { return State::default() };
    let Ok(state) = serde_json::from_str::<State>(&raw) else { return State::default() };
    if state.schema_version == SCHEMA_VERSION { state } else { State::default() }
}

fn advance(root: &Path, to: Phase) -> Result<State, String> {
    let mut state = read(root);
    if state.phase.rank() >= to.rank() {
        return Ok(state);
    }
    state.phase = to;
    write(root, &state)?;
    Ok(state)
}

pub fn mark_canvas(root: &Path) -> Result<State, String> {
    advance(root, Phase::Canvas)
}

/// A successful first sync resumes at workspace choice. Later syncs never
/// reopen a step the student already passed.
pub fn mark_workspace(root: &Path) -> Result<State, String> {
    advance(root, Phase::Workspace)
}

pub fn complete(root: &Path) -> Result<State, String> {
    let state = State { schema_version: SCHEMA_VERSION, phase: Phase::Ready, completed_at: Some(now_iso()) };
    write(root, &state)?;
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kairos-setup-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn lifecycle_only_moves_forward() {
        let dir = root("lifecycle");
        assert_eq!(read(&dir).phase, Phase::School);
        assert_eq!(mark_canvas(&dir).unwrap().phase, Phase::Canvas);
        assert_eq!(mark_workspace(&dir).unwrap().phase, Phase::Workspace);
        // A re-sync or a school re-pick must not reopen the Canvas step.
        assert_eq!(mark_canvas(&dir).unwrap().phase, Phase::Workspace);
        assert_eq!(complete(&dir).unwrap().phase, Phase::Ready);
        assert_eq!(mark_workspace(&dir).unwrap().phase, Phase::Ready);
        assert_eq!(mark_canvas(&dir).unwrap().phase, Phase::Ready);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn completion_is_recorded_as_rfc3339() {
        let dir = root("stamp");
        let state = complete(&dir).unwrap();
        let stamp = state.completed_at.unwrap();
        assert_eq!(stamp.len(), 20, "{stamp}");
        assert!(stamp.ends_with('Z'), "{stamp}");
        assert!(stamp.starts_with("20"), "{stamp}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn epoch_formatting_matches_known_instants() {
        assert_eq!(iso_from_epoch(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_from_epoch(1_000_000_000), "2001-09-09T01:46:40Z");
        // 2026-10-23T00:00:00Z, and a leap day.
        assert_eq!(iso_from_epoch(1_792_713_600), "2026-10-23T00:00:00Z");
        assert_eq!(iso_from_epoch(1_709_164_800), "2024-02-29T00:00:00Z");
    }
}
