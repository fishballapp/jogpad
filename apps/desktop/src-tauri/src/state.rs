//! Everything durable, behind one lock.
//!
//! Notes and preferences were previously two mutexes, and the code took them
//! in opposite orders in different places, which is a deadlock waiting for the
//! right interleaving. They are also not independent: renaming a section has
//! to move the active-section preference with it. One lock over both is
//! simpler and makes those operations atomic rather than merely ordered.

use crate::store::{self, Doc, Section, DEFAULT_SECTION};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager};

/// Everything that is not a note: which section captures land in, and how big
/// and how zoomed the panel was when you last touched it.
#[derive(Serialize, Deserialize, Clone)]
pub struct Prefs {
    pub active: String,
    pub zoom: f64,
    pub width: f64,
    pub height: f64,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            active: DEFAULT_SECTION.to_string(),
            zoom: 1.0,
            width: 380.0,
            height: 720.0,
        }
    }
}

pub struct Model {
    pub doc: Doc,
    pub prefs: Prefs,
    /// Set when the notes file exists but could not be read. Nothing is
    /// written while it is set, so a permissions problem or a bad encoding
    /// cannot be laundered into an empty file on the next capture.
    pub read_only: bool,
    /// Whatever went wrong most recently, for the front end to show.
    pub error: Option<String>,
}

pub struct AppState {
    pub notes_path: PathBuf,
    pub prefs_path: PathBuf,
    model: Mutex<Model>,
    /// Snapshots are emitted from commands, from the hotkey thread and from
    /// the permission poller, so they can arrive out of order. The front end
    /// keeps the highest it has seen.
    rev: AtomicU64,
}

#[derive(Serialize, Clone)]
pub struct Snapshot {
    pub rev: u64,
    pub sections: Vec<Section>,
    pub active: String,
    pub zoom: f64,
    pub notes_path: String,
    pub read_only: bool,
    pub error: Option<String>,
    /// Accessibility: reading the selection out of other apps.
    pub trusted: bool,
    /// Input Monitoring: seeing the Shift presses at all. A separate grant.
    pub input_monitoring: bool,
}

/// A panic elsewhere should not turn every later command into a panic too.
/// Nothing here leaves the model half-updated, so the data behind a poisoned
/// lock is still usable.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    pub fn new(notes_path: PathBuf, prefs_path: PathBuf, doc: Doc, prefs: Prefs) -> AppState {
        AppState {
            notes_path,
            prefs_path,
            model: Mutex::new(Model {
                doc,
                prefs,
                read_only: false,
                error: None,
            }),
            rev: AtomicU64::new(0),
        }
    }

    /// The model lock is held for the whole closure, so the closure must not
    /// reach back into `AppState`. Calling `with`, `snapshot` or `commit` from
    /// inside one deadlocks immediately. Read and mutate here, and do anything
    /// else after it returns.
    pub fn with<R>(&self, f: impl FnOnce(&mut Model) -> R) -> R {
        f(&mut lock(&self.model))
    }

    pub fn mark_unreadable(&self, message: String) {
        self.with(|m| {
            m.read_only = true;
            m.error = Some(message);
        });
    }

    pub fn snapshot(&self) -> Snapshot {
        // Both of these ask macOS about TCC state, which is slower and less
        // predictable than anything else here, so keep them off the lock.
        let trusted = crate::trusted();
        let input_monitoring = crate::input_monitoring();

        let model = lock(&self.model);
        Snapshot {
            rev: self.rev.fetch_add(1, Ordering::Relaxed),
            sections: model.doc.sections.clone(),
            active: model.prefs.active.clone(),
            zoom: model.prefs.zoom,
            notes_path: self.notes_path.display().to_string(),
            read_only: model.read_only,
            error: model.error.clone(),
            trusted,
            input_monitoring,
        }
    }

    /// Returns the message worth showing if the write failed.
    fn write_notes(&self) -> Option<String> {
        // Serialise under the lock, write outside it. Holding the model across
        // a filesystem call would stall every capture and command behind a
        // slow disk.
        let markdown = self.with(|m| (!m.read_only).then(|| m.doc.to_markdown()))?;
        problem(
            store::write_atomic(&self.notes_path, markdown.as_bytes()),
            &self.notes_path,
        )
    }

    fn write_prefs(&self) -> Option<String> {
        let prefs = self.with(|m| m.prefs.clone());
        let json = serde_json::to_string_pretty(&prefs).ok()?;
        // Preference writes fail the same way notes writes do, so they are
        // reported the same way rather than only to a stderr nobody reads.
        problem(
            store::write_atomic(&self.prefs_path, json.as_bytes()),
            &self.prefs_path,
        )
    }

    /// Write everything and record whatever went wrong. Both writes are
    /// attempted: a failing notes file must not stop preferences being saved.
    pub fn save(&self) {
        let notes = self.write_notes();
        let prefs = self.write_prefs();
        self.with(|m| m.error = notes.or(prefs));
    }

    pub fn save_prefs(&self) {
        let problem = self.write_prefs();
        self.with(|m| m.error = problem);
    }
}

fn problem(result: std::io::Result<()>, path: &std::path::Path) -> Option<String> {
    result.err().map(|e| {
        let message = format!("Could not write {}: {e}", path.display());
        eprintln!("jogpad: {message}");
        message
    })
}

/// Every mutation funnels through here. Persistence can still fail, and when
/// it does the failure travels to the front end in the snapshot rather than
/// only to stderr, which nobody reads in a menu bar app.
pub fn commit(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.save();
    let _ = app.emit("notes", state.snapshot());
}

/// A change that touches preferences but not the document.
pub fn commit_prefs(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.save_prefs();
    let _ = app.emit("notes", state.snapshot());
}
