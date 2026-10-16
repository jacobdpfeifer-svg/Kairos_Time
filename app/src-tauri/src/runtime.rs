//! Installed-runtime contract (CONTRACTS C-01, DECISIONS D-08).
//!
//! The app never assumes a repository checkout, a system `python3`, or `npm`.
//! Resolution order for each resource:
//!
//! 1. `KAIROS_CORE_DIR` / `KAIROS_PYTHON` / `KAIROS_NODE` env overrides
//!    (developer + test harness).
//! 2. Bundled resources next to the binary: `<resources>/core/{src,browser,templates,
//!    schools,skills}` and `<resources>/runtime/{python,node}/bin/...`.
//! 3. Dev fallback: the repository around `CARGO_MANIFEST_DIR` with `python3` and
//!    `node` from `PATH` — labeled `dev`, never presented as an installed run.
//!
//! Profile identity: `<app_support>/Kairos/current_profile` holds the active
//! profile id (validated). Every child process receives `PRODUCT_USER_ID`, so the
//! Rust, Python and JS resolvers agree on `{user_root}`.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

pub const PRODUCT_DIR: &str = "Kairos";
pub const DEFAULT_PROFILE: &str = "dev";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum RuntimeMode {
    Bundled,
    Dev,
    /// Bundled resources present but the bundled interpreter is missing: every
    /// core command fails closed with a diagnostic instead of running a system
    /// Python that was never validated (audit A runtime caveat).
    Broken,
}

#[derive(Debug, Clone, Serialize)]
pub struct Runtime {
    pub mode: RuntimeMode,
    /// Directory containing `src/`, `browser/`, `templates/`, `schools/`, `skills/`.
    pub core_dir: PathBuf,
    pub python: PathBuf,
    pub node: Option<PathBuf>,
    pub profile_id: String,
    pub user_root: PathBuf,
    /// Human-readable problems found at boot (missing resources, unwritable root).
    pub diagnostics: Vec<String>,
}

/// OS application-support root for the product (no profile id).
pub fn app_support_root() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home().join("Library").join("Application Support").join(PRODUCT_DIR)
    }
    #[cfg(target_os = "windows")]
    {
        env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData").join("Roaming"))
            .join(PRODUCT_DIR)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join(".local").join("share"))
            .join(PRODUCT_DIR)
    }
}

fn home() -> PathBuf {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// The profile holds SSO cookies, OAuth tokens, grades and private notes:
/// owner-only (0700), so no other local account can list or read it.
pub fn restrict_to_owner(dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    }
    #[cfg(not(unix))]
    let _ = dir;
}

pub fn valid_profile_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id != "."
        && id != ".."
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

fn current_profile_path() -> PathBuf {
    app_support_root().join("current_profile")
}

/// Active profile id: `PRODUCT_USER_ID` env, else the `current_profile` file, else `dev`.
pub fn current_profile_id() -> String {
    if let Ok(id) = env::var("PRODUCT_USER_ID") {
        let id = id.trim().to_string();
        if valid_profile_id(&id) {
            return id;
        }
    }
    if let Ok(raw) = fs::read_to_string(current_profile_path()) {
        let id = raw.trim().to_string();
        if valid_profile_id(&id) {
            return id;
        }
    }
    DEFAULT_PROFILE.to_string()
}

/// Persist the active profile id. Rejects ids that could escape the data root.
pub fn set_current_profile(id: &str) -> Result<(), String> {
    let id = id.trim();
    if !valid_profile_id(id) {
        return Err(format!("invalid profile id: {id:?}"));
    }
    let path = current_profile_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, id).map_err(|e| e.to_string())
}

/// `{user_root}` for a profile: `DEV_USER_ROOT` override, else `<app_support>/<id>`.
pub fn user_root_for(profile_id: &str) -> PathBuf {
    if let Ok(root) = env::var("DEV_USER_ROOT") {
        let trimmed = root.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    app_support_root().join(profile_id)
}

fn dev_core_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn exe_on_path(name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    // Homebrew on Apple Silicon is often absent from a GUI app's PATH.
    for extra in ["/opt/homebrew/bin", "/usr/local/bin"] {
        let candidate = Path::new(extra).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Browser the Canvas scripts drive. An installed app never has Playwright's
/// downloaded Chromium (that cache exists only on developer machines), so it
/// drives the student's installed Google Chrome unless a channel is set
/// explicitly. Dev runs keep Playwright's default when nothing is set.
pub fn playwright_channel(mode: &RuntimeMode, configured: Option<&str>) -> String {
    match configured.map(str::trim) {
        Some(c) if !c.is_empty() => c.to_string(),
        _ if *mode == RuntimeMode::Dev => String::new(),
        _ => "chrome".to_string(),
    }
}

#[cfg(target_os = "macos")]
fn chrome_installed() -> bool {
    [
        PathBuf::from("/Applications/Google Chrome.app"),
        home().join("Applications").join("Google Chrome.app"),
    ]
    .iter()
    .any(|p| p.is_dir())
}

#[cfg(not(target_os = "macos"))]
fn chrome_installed() -> bool {
    true
}

/// Resolve the runtime. `resource_dir` is Tauri's bundled resource directory
/// when available (None in unit tests).
pub fn resolve(resource_dir: Option<&Path>) -> Runtime {
    let mut diagnostics = Vec::new();
    let profile_id = current_profile_id();
    let user_root = user_root_for(&profile_id);

    let env_core = env::var_os("KAIROS_CORE_DIR").map(PathBuf::from);
    let bundled_core = resource_dir.map(|r| r.join("core"));
    let (mode, core_dir) = match (env_core, bundled_core) {
        (Some(dir), _) if dir.join("src").is_dir() => (RuntimeMode::Bundled, dir),
        (_, Some(dir)) if dir.join("src").is_dir() => (RuntimeMode::Bundled, dir),
        _ => {
            let dir = dev_core_dir();
            if !dir.join("src").is_dir() {
                diagnostics.push(format!(
                    "core resources missing: no bundled core/ and no checkout at {}",
                    dir.display()
                ));
            }
            (RuntimeMode::Dev, dir)
        }
    };

    let mut mode = mode;
    let python = env::var_os("KAIROS_PYTHON")
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .or_else(|| {
            resource_dir.and_then(|r| {
                let unix = r.join("runtime").join("python").join("bin").join("python3");
                let win = r.join("runtime").join("python").join("python.exe");
                if unix.is_file() {
                    Some(unix)
                } else if win.is_file() {
                    Some(win)
                } else {
                    None
                }
            })
        })
        .or_else(|| {
            if mode == RuntimeMode::Dev {
                // Prefer the repo venv when present: /usr/bin/python3 may be 3.9.
                let venv = core_dir.join(".venv").join("bin").join("python");
                if venv.is_file() {
                    return Some(venv);
                }
                exe_on_path("python3")
            } else {
                None
            }
        })
        .unwrap_or_else(|| {
            diagnostics.push(
                "Python runtime not found: the bundled runtime/python is missing, so study and planning commands are disabled".into(),
            );
            if mode == RuntimeMode::Bundled {
                mode = RuntimeMode::Broken;
            }
            PathBuf::new()
        });

    let node = env::var_os("KAIROS_NODE")
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .or_else(|| {
            resource_dir.and_then(|r| {
                let unix = r.join("runtime").join("node").join("bin").join("node");
                let win = r.join("runtime").join("node").join("node.exe");
                if unix.is_file() {
                    Some(unix)
                } else if win.is_file() {
                    Some(win)
                } else {
                    None
                }
            })
        })
        .or_else(|| if mode == RuntimeMode::Dev { exe_on_path("node") } else { None });
    if node.is_none() {
        diagnostics.push("Node runtime not found: Canvas sync is unavailable until it is installed".into());
    }
    if mode != RuntimeMode::Dev
        && playwright_channel(&mode, env::var("PLAYWRIGHT_CHANNEL").ok().as_deref()) == "chrome"
        && !chrome_installed()
    {
        diagnostics.push(
            "Google Chrome not found: Canvas sign-in and sync open your school's login in Chrome. Install Chrome, then reopen Kairos".into(),
        );
    }
    if !core_dir.join("browser").join("scripts").is_dir() {
        diagnostics.push("browser sync scripts missing from core resources".into());
    }
    if let Err(e) = fs::create_dir_all(&user_root) {
        diagnostics.push(format!("cannot create profile directory {}: {e}", user_root.display()));
    }
    restrict_to_owner(&user_root);

    Runtime {
        mode,
        core_dir,
        python,
        node,
        profile_id,
        user_root,
        diagnostics,
    }
}

impl Runtime {
    /// Environment every child process receives so all resolvers agree.
    pub fn apply_env(&self, cmd: &mut Command) {
        cmd.env("PRODUCT_USER_ID", &self.profile_id);
        if let Ok(root) = env::var("DEV_USER_ROOT") {
            cmd.env("DEV_USER_ROOT", root);
        }
        if let Ok(slug) = env::var("SCHOOL_SLUG") {
            cmd.env("SCHOOL_SLUG", slug);
        }
        cmd.env("AUTH_DIR", self.user_root.join("auth").join("browser"));
        // Node sync scripts run `learn_loop reconcile` with this interpreter
        // (browser/scripts/lib/reconcile-command.mjs), never a developer helper.
        if !self.python.as_os_str().is_empty() {
            cmd.env("KAIROS_PYTHON", &self.python);
        }
        cmd.env(
            "KAIROS_TEMPLATES_DIR",
            self.core_dir.join("templates").join("study-packets"),
        );
        let src = self.core_dir.join("src");
        if self.mode == RuntimeMode::Dev {
            let existing = env::var("PYTHONPATH").unwrap_or_default();
            let joined = if existing.is_empty() {
                src.display().to_string()
            } else {
                format!("{}:{}", src.display(), existing)
            };
            cmd.env("PYTHONPATH", joined);
        } else {
            // Packaged run: only our source on the path, no host PYTHONPATH or user site.
            cmd.env("PYTHONPATH", src.display().to_string());
            cmd.env("PYTHONNOUSERSITE", "1");
            cmd.env("PYTHONDONTWRITEBYTECODE", "1");
            cmd.env_remove("PYTHONHOME");
            cmd.env_remove("PYTHONSTARTUP");
            // A launchd-wide NODE_OPTIONS (--require/--import) would load
            // foreign code into every sync with the student's Canvas session.
            cmd.env_remove("NODE_OPTIONS");
        }
    }

    /// `python -m <module> args…` with cwd = core dir. In `Broken` mode the
    /// command targets an empty path and fails to spawn with a clear message.
    pub fn python_module(&self, module: &str, args: &[&str]) -> Command {
        let mut cmd = Command::new(if self.python.as_os_str().is_empty() {
            Path::new("/nonexistent/kairos-python-missing")
        } else {
            self.python.as_path()
        });
        // `-s`: never import the developer's user site-packages. cwd is `src/`
        // so `-m canvas_mcp…` resolves without relying on PYTHONPATH.
        cmd.arg("-s")
            .arg("-m")
            .arg(module)
            .args(args)
            .current_dir(self.core_dir.join("src"));
        self.apply_env(&mut cmd);
        cmd
    }

    /// The study core as a top-level `study` package (cwd = `src/canvas_mcp/core`).
    /// This bypasses `canvas_mcp/__init__` (which imports the MCP server and its
    /// third-party deps), so the primary journey needs only the standard library
    /// in a packaged run. `--user-root` is always passed: the core never has to
    /// resolve identity itself on this path.
    pub fn study_command(&self, args: &[&str]) -> Command {
        self.core_module_command("study", args)
    }

    /// A stdlib-only core module run the same way as the study core (`week_plan`).
    pub fn core_module_command(&self, module: &str, args: &[&str]) -> Command {
        let mut cmd = Command::new(if self.python.as_os_str().is_empty() {
            Path::new("/nonexistent/kairos-python-missing")
        } else {
            self.python.as_path()
        });
        let root = self.user_root.display().to_string();
        cmd.arg("-s")
            .arg("-m")
            .arg(module)
            .arg("--user-root")
            .arg(root)
            .args(args)
            .current_dir(self.core_dir.join("src").join("canvas_mcp").join("core"));
        self.apply_env(&mut cmd);
        // No PYTHONPATH at all on this path: only cwd (the core package dir).
        cmd.env_remove("PYTHONPATH");
        cmd
    }

    pub fn usable(&self) -> Result<(), String> {
        if self.mode == RuntimeMode::Broken {
            return Err(format!(
                "This installation is missing its Python runtime. {}",
                self.diagnostics.join("; ")
            ));
        }
        Ok(())
    }

    /// `node browser/scripts/<script>.mjs` — replaces `npm run <script>` so no npm is needed.
    pub fn browser_script(&self, script: &str) -> Result<Command, String> {
        let node = self
            .node
            .as_ref()
            .ok_or_else(|| "Node runtime not available; Canvas sync cannot run".to_string())?;
        let browser = self.core_dir.join("browser");
        let path = browser.join("scripts").join(format!("{script}.mjs"));
        if !path.is_file() {
            return Err(format!("sync script missing: {}", path.display()));
        }
        let mut cmd = Command::new(node);
        cmd.arg(&path).current_dir(&browser);
        self.apply_env(&mut cmd);
        cmd.env(
            "PLAYWRIGHT_CHANNEL",
            playwright_channel(&self.mode, env::var("PLAYWRIGHT_CHANNEL").ok().as_deref()),
        );
        Ok(cmd)
    }

    pub fn summary(&self) -> serde_json::Value {
        serde_json::json!({
            "mode": match self.mode { RuntimeMode::Bundled => "bundled", RuntimeMode::Dev => "dev", RuntimeMode::Broken => "broken" },
            "core_dir": self.core_dir.display().to_string(),
            "python": self.python.display().to_string(),
            "node": self.node.as_ref().map(|p| p.display().to_string()),
            "profile_id": self.profile_id,
            "user_root": self.user_root.display().to_string(),
            "diagnostics": self.diagnostics,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_ids_are_bounded() {
        assert!(valid_profile_id("dev"));
        assert!(valid_profile_id("student-2.a_b"));
        assert!(!valid_profile_id(""));
        assert!(!valid_profile_id(".."));
        assert!(!valid_profile_id("a/b"));
        assert!(!valid_profile_id("a\\b"));
        assert!(!valid_profile_id(&"x".repeat(65)));
    }

    #[test]
    fn installed_runs_drive_installed_chrome_not_a_downloaded_chromium() {
        assert_eq!(playwright_channel(&RuntimeMode::Bundled, None), "chrome");
        assert_eq!(playwright_channel(&RuntimeMode::Bundled, Some("")), "chrome");
        assert_eq!(playwright_channel(&RuntimeMode::Broken, None), "chrome");
        assert_eq!(playwright_channel(&RuntimeMode::Bundled, Some("msedge")), "msedge");
        assert_eq!(playwright_channel(&RuntimeMode::Dev, None), "");
        assert_eq!(playwright_channel(&RuntimeMode::Dev, Some("chrome")), "chrome");
    }

    #[test]
    fn env_overrides_win_and_dev_falls_back_to_checkout() {
        let rt = resolve(None);
        assert!(rt.core_dir.join("src").is_dir(), "dev fallback finds the checkout");
        assert!(rt.user_root.ends_with(rt.profile_id.clone()) || env::var("DEV_USER_ROOT").is_ok());
    }

    #[test]
    fn child_env_carries_identity() {
        let rt = resolve(None);
        let cmd = rt.python_module("canvas_mcp.core.study", &["status"]);
        let envs: Vec<(String, String)> = cmd
            .get_envs()
            .filter_map(|(k, v)| Some((k.to_string_lossy().to_string(), v?.to_string_lossy().to_string())))
            .collect();
        assert!(envs.iter().any(|(k, v)| k == "PRODUCT_USER_ID" && v == &rt.profile_id));
        assert!(envs.iter().any(|(k, v)| k == "AUTH_DIR" && v.ends_with("auth/browser")));
        assert!(envs.iter().any(|(k, _)| k == "PYTHONPATH"));
        if !rt.python.as_os_str().is_empty() {
            assert!(envs.iter().any(|(k, v)| k == "KAIROS_PYTHON" && v == &rt.python.display().to_string()));
        }
    }

    #[test]
    fn browser_scripts_get_the_app_python_and_an_installed_browser_channel() {
        let mut rt = resolve(None);
        rt.mode = RuntimeMode::Bundled;
        rt.python = PathBuf::from("/Applications/Kairos.app/Contents/Resources/runtime/python/bin/python3");
        if rt.node.is_none() {
            rt.node = Some(PathBuf::from("/usr/bin/true"));
        }
        let cmd = match rt.browser_script("sync-canvas-canonical") {
            Ok(cmd) => cmd,
            Err(_) => return, // checkout without browser scripts
        };
        let envs: Vec<(String, String)> = cmd
            .get_envs()
            .filter_map(|(k, v)| Some((k.to_string_lossy().to_string(), v?.to_string_lossy().to_string())))
            .collect();
        assert!(envs.iter().any(|(k, v)| k == "KAIROS_PYTHON" && v.ends_with("runtime/python/bin/python3")));
        if env::var("PLAYWRIGHT_CHANNEL").map(|c| c.trim().is_empty()).unwrap_or(true) {
            assert!(envs.iter().any(|(k, v)| k == "PLAYWRIGHT_CHANNEL" && v == "chrome"));
        }
    }
}
