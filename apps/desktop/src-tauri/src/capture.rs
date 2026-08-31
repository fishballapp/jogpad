//! Waiting for permissions, then turning double-tap Shift into a note.
//!
//! macOS makes this harder than it sounds. Two separate grants are needed and
//! both usually arrive after launch, and a tap installed before they land is
//! handed back looking healthy while never delivering an event.

use crate::state::{commit, AppState};
use crate::store::Item;
use crate::{hotkey, panel, selection, set_visible};
use std::sync::mpsc::channel;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub fn spawn(app: AppHandle) {
    let (tx, rx) = channel();

    std::thread::spawn({
        let app = app.clone();
        move || {
            if wait_for_permissions(&app) {
                // A tap created inside a process that was already running when
                // the grant arrived comes back looking healthy and then never
                // delivers an event. Only a fresh process gets a live one, and
                // everything is already on disk, so just start over.
                app.restart();
            }
            loop {
                // Blocks on its own CFRunLoop while the tap is alive.
                hotkey::listen(tx.clone());
                std::thread::sleep(Duration::from_secs(2));
            }
        }
    });

    std::thread::spawn(move || {
        while let Ok(gesture) = rx.recv() {
            match gesture {
                hotkey::Gesture::LeftShiftDouble => capture(&app),
                hotkey::Gesture::RightShiftDouble => {
                    set_visible(&app, true);
                    let _ = app.emit("focus-input", ());
                }
            }
        }
    });
}

/// Returns true if anything had to change while we waited, which is the signal
/// that the process needs restarting before a tap will work.
fn wait_for_permissions(app: &AppHandle) -> bool {
    let mut seen = None;
    let mut waited = false;
    let mut asked = false;

    loop {
        let now = (selection::is_trusted(), hotkey::input_monitoring_granted());

        // Input Monitoring stays denied until the app actually asks, even
        // though holding Accessibility is enough for macOS to grant it without
        // a prompt. Ask once rather than making someone hunt for a permission
        // that is handed over silently.
        if now.0 && !now.1 && !asked {
            asked = true;
            hotkey::request_input_monitoring();
            // Granting it here still counts as arriving mid-life, so the
            // restart is needed even though nothing waited.
            waited = true;
            continue;
        }
        if Some(now) != seen {
            seen = Some(now);
            let _ = app.emit("notes", app.state::<AppState>().snapshot());
        }
        if now == (true, true) {
            panel::restore_floating(app);
            return waited;
        }
        waited = true;
        std::thread::sleep(Duration::from_secs(1));
    }
}

fn capture(app: &AppHandle) {
    let Some(text) = selection::current() else {
        return;
    };
    app.state::<AppState>().with(|m| {
        let name = m.prefs.active.clone();
        m.doc.section_mut(&name).items.push(Item::new(text));
    });
    commit(app);
    let _ = app.emit("captured", ());
}
