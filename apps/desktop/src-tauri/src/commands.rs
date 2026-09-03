//! The Tauri command surface. These are adapters: they validate, call into the
//! model under one lock, and commit. Domain logic belongs in `store`, and
//! anything durable belongs behind `AppState`.

use crate::state::{commit, commit_prefs, AppState, Snapshot, UpdateChannel};
use crate::store::{normalise_page_name, Item, DEFAULT_PAGE};
use crate::{is_visible, set_visible};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_updater::{Update, UpdaterExt};

#[tauri::command]
pub fn snapshot(state: State<AppState>) -> Snapshot {
    state.snapshot()
}

#[tauri::command]
pub fn add_item(app: AppHandle, text: String, page: Option<String>) {
    let text = text.trim().to_string();
    if text.is_empty() {
        return;
    }
    let page = match page {
        Some(name) => match normalise_page_name(&name) {
            Some(name) => Some(name),
            None => return,
        },
        None => None,
    };
    app.state::<AppState>().with(|m| {
        let name = page.unwrap_or_else(|| m.prefs.active.clone());
        m.doc.page_mut(&name).items.push(Item::new(text));
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

/// Set several items to one state at once, unlike `toggle_item` which flips
/// each. Toggling a mixed selection would only swap the mix around.
#[tauri::command]
pub fn set_done(app: AppHandle, ids: Vec<u64>, done: bool) {
    let changed = app.state::<AppState>().with(|m| {
        let mut changed = false;
        for id in &ids {
            if let Some(item) = m.doc.item_mut(*id) {
                if item.done != done {
                    item.done = done;
                    changed = true;
                }
            }
        }
        changed
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
pub fn move_items(app: AppHandle, ids: Vec<u64>, page: String) {
    let Some(page) = normalise_page_name(&page) else {
        return;
    };
    app.state::<AppState>().with(|m| {
        let moved = m.doc.take_items(&ids);
        m.doc.page_mut(&page).items.extend(moved);
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
pub fn set_active(app: AppHandle, page: String) {
    let Some(page) = normalise_page_name(&page) else {
        return;
    };
    app.state::<AppState>().with(|m| {
        m.doc.page_mut(&page);
        m.prefs.active = page;
    });
    commit(&app);
}

#[tauri::command]
pub fn rename_page(app: AppHandle, from: String, to: String) {
    let Some(to) = normalise_page_name(&to) else {
        return;
    };
    let renamed = app.state::<AppState>().with(|m| {
        if m.doc.pages.iter().any(|s| s.name == to) {
            return false;
        }
        let Some(page) = m.doc.pages.iter_mut().find(|s| s.name == from) else {
            // Renaming something that is not there must not move the active
            // preference onto a page that was never created.
            return false;
        };
        page.name = to.clone();
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
pub fn delete_page(app: AppHandle, page: String) {
    app.state::<AppState>().with(|m| {
        m.doc.pages.retain(|s| s.name != page);
        if m.doc.pages.is_empty() {
            m.doc.page_mut(DEFAULT_PAGE);
        }
        if m.prefs.active == page {
            m.prefs.active = m.doc.pages[0].name.clone();
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
    // Only after the clipboard write: checking off something that never made
    // it to the clipboard would lose it twice over.
    let checked = app.state::<AppState>().with(|m| {
        if !m.prefs.check_on_copy {
            return false;
        }
        let mut changed = false;
        for id in &ids {
            if let Some(item) = m.doc.item_mut(*id) {
                if !item.done {
                    item.done = true;
                    changed = true;
                }
            }
        }
        changed
    });
    if checked {
        commit(&app);
    }
    Ok(text)
}

/// Pull items out and drop them back in front of `before`, or at the end of
/// `page` when `before` is None. Drag and drop in the front end lands here.
#[tauri::command]
pub fn move_items_before(app: AppHandle, ids: Vec<u64>, before: Option<u64>, page: String) {
    let Some(page) = normalise_page_name(&page) else {
        return;
    };
    let moved = app
        .state::<AppState>()
        .with(|m| m.doc.move_items_before(&ids, before, &page));
    if moved {
        commit(&app);
    }
}

#[tauri::command]
pub fn set_check_on_copy(app: AppHandle, value: bool) {
    app.state::<AppState>()
        .with(|m| m.prefs.check_on_copy = value);
    commit_prefs(&app);
}

#[tauri::command]
pub fn set_group_done(app: AppHandle, value: bool) {
    app.state::<AppState>().with(|m| m.prefs.group_done = value);
    commit_prefs(&app);
}

/// Accessibility is not enough on its own: watching the keyboard needs Input
/// Monitoring, and macOS grants them independently.
#[tauri::command]
pub fn request_permissions(app: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use crate::{hotkey, panel, selection};

        // The panel floats above everything, which includes the system prompt
        // we are about to trigger. Get out of its way first. Settings floats
        // one level higher still and is never lowered, so it hides instead.
        if let Some(settings) = app.get_webview_window("settings") {
            let _ = settings.hide();
        }
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

/// The settings window exists from launch and closing it only hides it, so
/// opening is always a show, never a create.
#[tauri::command]
pub fn open_settings(app: AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
    }
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
    // Content only: the settings window keeps its size and scrolls instead.
    if let Some(settings) = app.get_webview_window("settings") {
        let _ = settings.set_zoom(zoom);
    }
    commit_prefs(&app);
}

/// An accessory app has no menu bar, so there is no system Quit item.
#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

/// The update found by the last check, tagged with the channel it came from.
/// The tag is what stops a switch to Beta installing a build that was found on
/// Stable: checks are network calls that can land out of order, so the channel
/// is compared against the live preference at install time rather than trusted
/// to still be whatever it was when the check started.
#[derive(Default)]
pub(crate) struct PendingUpdate(pub Mutex<Option<(UpdateChannel, Update)>>);

#[derive(Serialize, Clone, Debug)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

const STABLE_ENDPOINT: &str = "https://jogpad.fishball.app/latest.json";
const BETA_ENDPOINT: &str = "https://jogpad.fishball.app/beta.json";

#[tauri::command]
pub fn set_update_channel(
    app: AppHandle,
    channel: UpdateChannel,
    pending: State<'_, PendingUpdate>,
) {
    let changed = app.state::<AppState>().with(|m| {
        if m.prefs.update_channel == channel {
            return false;
        }
        m.prefs.update_channel = channel;
        true
    });
    if !changed {
        return;
    }
    // Drop whatever the old channel offered before anything can install it. The
    // model lock is already released here: taking it while holding this one is
    // the shape of the deadlock this codebase fixed once already.
    *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
    commit_prefs(&app);
}

#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let channel = app.state::<AppState>().with(|m| m.prefs.update_channel);
    let endpoint_url = match channel {
        UpdateChannel::Stable => STABLE_ENDPOINT,
        UpdateChannel::Beta => BETA_ENDPOINT,
    };
    let endpoint = endpoint_url
        .parse()
        .map_err(|e| format!("Invalid endpoint URL: {e}"))?;

    // Clear before asking, so a check that fails or finds nothing cannot leave
    // the previous answer sitting there installable.
    *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = None;

    let update = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        notes: u.body.clone(),
    });

    let mut guard = pending.0.lock().unwrap_or_else(|e| e.into_inner());
    *guard = update.map(|u| (channel, u));

    Ok(info)
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let channel = app.state::<AppState>().with(|m| m.prefs.update_channel);
    let update = {
        let mut guard = pending.0.lock().unwrap_or_else(|e| e.into_inner());
        // A check that started before a channel switch can land after it, so the
        // channel stored alongside the update is the only thing that proves it
        // belongs to the channel the user is actually on.
        match guard.take() {
            Some((found_on, update)) if found_on == channel => update,
            _ => return Err("That update was found on a different channel. Check again.".into()),
        }
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    // WHY: app.restart() creates a new process after Accessibility and Input
    // Monitoring are already granted. In that fresh process wait_for_permissions
    // observes (true, true) immediately with waited == false, does not restart again,
    // and creates the event tap in a process born after the grants.
    app.restart();
}
