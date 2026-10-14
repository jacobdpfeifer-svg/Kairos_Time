//! Main window geometry.
//!
//! The window is a normal, resizable study workspace. `Onboarding` is the
//! one-time centered size used before a profile exists. The compact glass
//! "Peek" sticky note was retired on 2026-10-13 (MASTER §10 menu bar: no glass
//! peek window); older callers that still ask for `peek`/`expanded` get the
//! workspace.

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

pub const MAIN_WINDOW: &str = "main";
const MARGIN_LOGICAL: f64 = 20.0;
const ONBOARDING_W: f64 = 560.0;
const ONBOARDING_H: f64 = 680.0;
const WORKSPACE_W: f64 = 1080.0;
const WORKSPACE_H: f64 = 740.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DockMode {
    Onboarding,
    Workspace,
}

impl DockMode {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "onboarding" => Some(Self::Onboarding),
            "workspace" | "peek" | "expanded" => Some(Self::Workspace),
            _ => None,
        }
    }
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| "main window not found".to_string())
}

/// Size and center the window for `mode`. The workspace keeps whatever size
/// the student gave it once it is already at least the minimum.
pub fn place(window: &WebviewWindow, mode: DockMode) -> tauri::Result<()> {
    let monitor = window
        .primary_monitor()?
        .or(window.current_monitor()?)
        .ok_or(tauri::Error::FailedToReceiveMessage)?;
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let work_h_logical = work.size.height as f64 / scale;
    let (w, h) = match mode {
        DockMode::Onboarding => (ONBOARDING_W, ONBOARDING_H),
        DockMode::Workspace => (
            WORKSPACE_W,
            WORKSPACE_H.min(work_h_logical - 2.0 * MARGIN_LOGICAL),
        ),
    };
    let _ = window.set_always_on_top(false);
    let _ = window.set_decorations(true);
    let _ = window.set_skip_taskbar(false);
    let _ = window.set_resizable(mode == DockMode::Workspace);
    if mode == DockMode::Workspace {
        if let Ok(size) = window.inner_size() {
            if size.width as f64 / scale >= 720.0 && size.height as f64 / scale >= 520.0 {
                return Ok(());
            }
        }
    }
    let end_w = (w * scale).round() as u32;
    let end_h = (h * scale).round() as u32;
    window.set_size(PhysicalSize::new(end_w, end_h))?;
    let x = work.position.x + (work.size.width as i32 - end_w as i32) / 2;
    let y = work.position.y + (work.size.height as i32 - end_h as i32) / 2;
    window.set_position(PhysicalPosition::new(x, y))?;
    Ok(())
}

/// Bring the workspace forward: tray rows, `kairos://` links, the capture hotkey, Dock reopen.
pub fn show_workspace(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

/// Tray left-click: show the workspace, or hide it if it is already in front.
pub fn toggle(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    let visible = window.is_visible().map_err(|e| e.to_string())?;
    let focused = window.is_focused().unwrap_or(false);
    if visible && focused {
        window.hide().map_err(|e| e.to_string())
    } else {
        show_workspace(app)
    }
}

#[tauri::command]
pub fn set_dock_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let mode = DockMode::parse(&mode).ok_or_else(|| format!("unknown dock mode: {mode}"))?;
    place(&main_window(&app)?, mode).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::DockMode;

    #[test]
    fn retired_compact_modes_open_the_workspace() {
        assert_eq!(DockMode::parse("peek"), Some(DockMode::Workspace));
        assert_eq!(DockMode::parse("expanded"), Some(DockMode::Workspace));
        assert_eq!(DockMode::parse("onboarding"), Some(DockMode::Onboarding));
        assert_eq!(DockMode::parse("glass"), None);
    }
}
