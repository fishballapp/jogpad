//! Waiting for permissions, then acting on double-tap Shift.
//!
//! macOS makes this harder than it sounds. Two separate grants are needed and
//! both usually arrive after launch, and a tap installed before they land is
//! handed back looking healthy while never delivering an event.

use crate::{has_focus, hotkey, panel, selection};

use std::sync::mpsc::channel;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

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
        while rx.recv().is_ok() {
            gesture(&app);
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
            let status = crate::commands::permissions();
            let _ = app.emit("permissions", status);
        }
        if now == (true, true) {
            panel::restore_floating(app);
            return waited;
        }
        waited = true;
        std::thread::sleep(Duration::from_secs(1));
    }
}

#[derive(serde::Serialize, Clone)]
struct Gesture {
    focused: bool,
    selection: Option<String>,
}

/// The rule for what a double tap means lives in the front end, shared with
/// the website. This side only reports what it alone can see.
fn gesture(app: &AppHandle) {
    let focused = has_focus(app);
    // Read the selection only when it could matter: reading it is an AX
    // round trip into the frontmost app.
    let selection = if focused { None } else { selection::current() };
    // One gesture covers the three things you can want from a scratchpad: put
    // away the one you are typing in, file what you have selected, or open it to
    // type. Which one you meant is decided by where the keyboard is and whether
    // anything is selected.
    let _ = app.emit("gesture", Gesture { focused, selection });
}
