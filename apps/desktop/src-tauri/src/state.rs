//! Window state and path mapping.
//!
//! Rust no longer holds any notes model or domain logic. It owns the panel's
//! size and zoom in `window.json` and serves `notes.md` and `prefs.json` as
//! plain text through `fs_read`/`fs_write`.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

pub struct AppState {
    pub dir: PathBuf, // app data dir
    /// The panel's size, in logical pixels, and the zoom the webview is at.
    /// Kept by Rust because it writes them on every resize, and one file
    /// needs one writer. Lives in window.json.
    window: Mutex<WindowState>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub zoom: f64,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    pub fn new(dir: PathBuf, window: WindowState) -> AppState {
        AppState {
            dir,
            window: Mutex::new(window),
        }
    }

    /// Maps "notes.md" and "prefs.json" (and "window.json" internally) under `dir`.
    /// Any other name is an error, returned as `String`.
    pub fn path(&self, name: &str) -> Result<PathBuf, String> {
        match name {
            "notes.md" | "prefs.json" | "window.json" => Ok(self.dir.join(name)),
            _ => Err(format!("Unknown file: {name}")),
        }
    }

    /// Maps an attachment ref, `attachments/<file>`, under `dir`. The file
    /// part is one plain name: no separators, no dots-only names, so a ref
    /// from the notes file can never reach outside the folder.
    pub fn attachment_path(&self, attachment_ref: &str) -> Result<PathBuf, String> {
        let file = attachment_ref
            .strip_prefix("attachments/")
            .filter(|f| !f.is_empty() && f.chars().all(|c| c.is_ascii_alphanumeric() || c == '.'))
            .filter(|f| f.chars().any(|c| c != '.'))
            .ok_or_else(|| format!("Not an attachment: {attachment_ref}"))?;
        Ok(self.dir.join("attachments").join(file))
    }

    pub fn window(&self) -> WindowState {
        lock(&self.window).clone()
    }

    pub fn update_size(&self, width: f64, height: f64) -> Result<(), String> {
        let (changed, window) = {
            let mut guard = lock(&self.window);
            if guard.width == width && guard.height == height {
                (false, guard.clone())
            } else {
                guard.width = width;
                guard.height = height;
                (true, guard.clone())
            }
        };
        // Quitting does not flush anything, so a resize with no following
        // edit would otherwise be forgotten.
        if changed {
            self.write_window(&window)?;
        }
        Ok(())
    }

    pub fn set_zoom(&self, zoom: f64) -> Result<(f64, f64, f64, f64), String> {
        let (ratio, width, height, actual_zoom, window) = {
            let mut guard = lock(&self.window);
            let ratio = zoom / guard.zoom;
            guard.zoom = zoom;
            guard.width *= ratio;
            guard.height *= ratio;
            (ratio, guard.width, guard.height, guard.zoom, guard.clone())
        };
        self.write_window(&window)?;
        Ok((ratio, width, height, actual_zoom))
    }

    fn write_window(&self, window: &WindowState) -> Result<(), String> {
        let path = self.path("window.json")?;
        let json = serde_json::to_string_pretty(window).map_err(|e| e.to_string())?;
        crate::store::write_atomic(&path, json.as_bytes()).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_only_allows_whitelisted_files() {
        let dir = PathBuf::from("/tmp");
        let state = AppState::new(
            dir.clone(),
            WindowState {
                width: 380.0,
                height: 720.0,
                zoom: 1.0,
            },
        );
        assert_eq!(state.path("notes.md").unwrap(), dir.join("notes.md"));
        assert_eq!(state.path("prefs.json").unwrap(), dir.join("prefs.json"));
        assert_eq!(state.path("window.json").unwrap(), dir.join("window.json"));
        assert!(state.path("secret.txt").is_err());
        assert!(state.path("../notes.md").is_err());
    }

    #[test]
    fn attachment_refs_stay_inside_the_folder() {
        let dir = PathBuf::from("/tmp");
        let state = AppState::new(
            dir.clone(),
            WindowState {
                width: 380.0,
                height: 720.0,
                zoom: 1.0,
            },
        );
        assert_eq!(
            state.attachment_path("attachments/abc123.png").unwrap(),
            dir.join("attachments").join("abc123.png")
        );
        assert!(state.attachment_path("attachments/../notes.md").is_err());
        assert!(state.attachment_path("attachments/a/b.png").is_err());
        assert!(state.attachment_path("attachments/..").is_err());
        assert!(state.attachment_path("attachments/").is_err());
        assert!(state.attachment_path("notes.md").is_err());
    }
}
