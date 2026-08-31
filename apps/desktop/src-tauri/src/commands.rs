//! The Tauri command surface. These are adapters: they validate, call into the
//! model under one lock, and commit. Domain logic belongs in `store`, and
//! anything durable belongs behind `AppState`.

use crate::state::{commit, commit_prefs, AppState, Snapshot};
use crate::store::{normalise_section_name, Item, DEFAULT_SECTION};
use crate::{is_visible, set_visible};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[tauri::command]
pub fn snapshot(state: State<AppState>) -> Snapshot {
    state.snapshot()
}

#[tauri::command]
pub fn add_item(app: AppHandle, text: String, section: Option<String>) {
    let text = text.trim().to_string();
    if text.is_empty() {
        return;
    }
    let section = match section {
        Some(name) => match normalise_section_name(&name) {
            Some(name) => Some(name),
            None => return,
        },
        None => None,
    };
    app.state::<AppState>().with(|m| {
        let name = section.unwrap_or_else(|| m.prefs.active.clone());
        m.doc.section_mut(&name).items.push(Item::new(text));
    });
    commit(&app);
}

#[tauri::command]
pub fn update_item(app: AppHandle, id: u64, text: String) {
    let changed = app.state::<AppState>().with(|m| {
        // Clearing an item is how you delete it.
        if text.trim().is_empty() {
            !m.doc.take_items(&[id]).is_empty()
        } else if let Some(item) = m.doc.item_mut(id) {
            item.text = text;
            true
        } else {
            false
        }
    });
    if changed {
        commit(&app);
    }
}

#[tauri::command]
pub fn toggle_item(app: AppHandle, id: u64) {
    let changed = app.state::<AppState>().with(|m| match m.doc.item_mut(id) {
        Some(item) => {
            item.done = !item.done;
            true
        }
        None => false,
    });
    if changed {
        commit(&app);
    }
}

#[tauri::command]
pub fn delete_items(app: AppHandle, ids: Vec<u64>) {
    app.state::<AppState>().with(|m| m.doc.take_items(&ids));
    commit(&app);
}

#[tauri::command]
pub fn move_items(app: AppHandle, ids: Vec<u64>, section: String) {
    let Some(section) = normalise_section_name(&section) else {
        return;
    };
    app.state::<AppState>().with(|m| {
        let moved = m.doc.take_items(&ids);
        m.doc.section_mut(&section).items.extend(moved);
    });
    commit(&app);
}

/// Fold several items into the first one, keeping its position and its
/// checkbox state.
#[tauri::command]
pub fn merge_items(app: AppHandle, ids: Vec<u64>) {
    let merged = app.state::<AppState>().with(|m| {
        let ordered: Vec<u64> = m.doc.items_in_order(&ids).iter().map(|i| i.id).collect();
        if ordered.len() < 2 {
            return false;
        }
        let text = m
            .doc
            .items_in_order(&ids)
            .iter()
            .map(|i| i.text.clone())
            .collect::<Vec<_>>()
            .join("\n\n");
        let keep = ordered[0];
        m.doc.take_items(&ordered[1..]);
        if let Some(item) = m.doc.item_mut(keep) {
            item.text = text;
        }
        true
    });
    if merged {
        commit(&app);
    }
}

#[tauri::command]
pub fn set_active(app: AppHandle, section: String) {
    let Some(section) = normalise_section_name(&section) else {
        return;
    };
    app.state::<AppState>().with(|m| {
        m.doc.section_mut(&section);
        m.prefs.active = section;
    });
    commit(&app);
}

#[tauri::command]
pub fn rename_section(app: AppHandle, from: String, to: String) {
    let Some(to) = normalise_section_name(&to) else {
        return;
    };
    let renamed = app.state::<AppState>().with(|m| {
        if m.doc.sections.iter().any(|s| s.name == to) {
            return false;
        }
        let Some(section) = m.doc.sections.iter_mut().find(|s| s.name == from) else {
            // Renaming something that is not there must not move the active
            // preference onto a section that was never created.
            return false;
        };
        section.name = to.clone();
        if m.prefs.active == from {
            m.prefs.active = to;
        }
        true
    });
    if renamed {
        commit(&app);
    }
}

#[tauri::command]
pub fn delete_section(app: AppHandle, section: String) {
    app.state::<AppState>().with(|m| {
        m.doc.sections.retain(|s| s.name != section);
        if m.doc.sections.is_empty() {
            m.doc.section_mut(DEFAULT_SECTION);
        }
        if m.prefs.active == section {
            m.prefs.active = m.doc.sections[0].name.clone();
        }
    });
    commit(&app);
}

/// The whole point of the app: several items, one numbered list, ready to paste.
#[tauri::command]
pub fn copy_as_list(app: AppHandle, ids: Vec<u64>) -> Result<String, String> {
    let text = app.state::<AppState>().with(|m| {
        let items = m.doc.items_in_order(&ids);
        if items.len() == 1 {
            items[0].text.clone()
        } else {
            items
                .iter()
                .enumerate()
                .map(|(i, item)| format!("{}. {}", i + 1, item.text.replace('\n', "\n   ")))
                .collect::<Vec<_>>()
                .join("\n")
        }
    });
    // Saying "Copied" when the clipboard write failed is worse than saying
    // nothing, so this failure reaches the front end.
    app.clipboard()
        .write_text(text.clone())
        .map_err(|e| e.to_string())?;
    Ok(text)
}

/// Accessibility is not enough on its own: watching the keyboard needs Input
/// Monitoring, and macOS grants them independently.
#[tauri::command]
pub fn request_permissions(app: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use crate::{hotkey, panel, selection};

        // The panel floats above everything, which includes the system prompt
        // we are about to trigger. Get out of its way first.
        panel::set_floating(&app, false);

        // Accessibility comes first. It is the prerequisite, and once it is
        // held macOS grants Input Monitoring without a prompt, so asking for
        // Input Monitoring beforehand only risks spending its one-shot prompt
        // in a state where the answer would be no.
        //
        // These prompts are one-shot per app: once macOS has asked and been
        // answered, or dismissed, calling again does nothing at all. So ask,
        // then offer somewhere the answer can actually be changed.
        let pane = if !selection::is_trusted() {
            selection::request_trust();
            Some("Privacy_Accessibility")
        } else if !hotkey::input_monitoring_granted() {
            hotkey::request_input_monitoring();
            (!hotkey::input_monitoring_granted()).then_some("Privacy_ListenEvent")
        } else {
            None
        };
        if let Some(pane) = pane {
            let _ = tauri_plugin_opener::open_url(
                format!("x-apple.systempreferences:com.apple.preference.security?{pane}"),
                None::<&str>,
            );
        }
    }
    let _ = app.emit("notes", app.state::<AppState>().snapshot());
}

#[tauri::command]
pub fn reveal_notes(app: AppHandle) -> Result<(), String> {
    let path = app.state::<AppState>().notes_path.clone();
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

/// The panel never activates the app, so the menu bar's Cmd+W may never fire.
/// The front end sends the shortcut here instead.
#[tauri::command]
pub fn hide_window(app: AppHandle) {
    set_visible(&app, false);
}

#[tauri::command]
pub fn toggle_window(app: AppHandle) {
    set_visible(&app, !is_visible(&app));
}

/// Zoom scales the window along with the content, so a zoomed-in panel shows
/// the same amount of text at a larger size rather than less text.
#[tauri::command]
pub fn set_zoom(app: AppHandle, zoom: f64) {
    // Round, or repeated steps drift into 1.2000000000000002.
    let zoom = (zoom.clamp(0.6, 2.0) * 100.0).round() / 100.0;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    // Scale by the ratio rather than off a fixed base, so a window the user
    // dragged to a new size keeps that size through a zoom change.
    let (ratio, width, height) = app.state::<AppState>().with(|m| {
        let ratio = zoom / m.prefs.zoom;
        m.prefs.zoom = zoom;
        m.prefs.width *= ratio;
        m.prefs.height *= ratio;
        (ratio, m.prefs.width, m.prefs.height)
    });
    if (ratio - 1.0).abs() > f64::EPSILON {
        let _ = window.set_size(LogicalSize::new(width, height));
    }
    let _ = window.set_zoom(zoom);
    commit_prefs(&app);
}

/// An accessory app has no menu bar, so there is no system Quit item.
#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}
