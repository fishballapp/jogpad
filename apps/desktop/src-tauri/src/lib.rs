mod store;

#[cfg(target_os = "macos")]
mod hotkey;
#[cfg(target_os = "macos")]
mod panel;
#[cfg(target_os = "macos")]
mod selection;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use store::{Doc, Item, Section, DEFAULT_SECTION};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

struct AppState {
    notes_path: PathBuf,
    prefs_path: PathBuf,
    doc: Mutex<Doc>,
    prefs: Mutex<Prefs>,
}

/// Everything that is not a note: which section captures land in, and how big
/// and how zoomed the panel was when you last touched it.
#[derive(Serialize, Deserialize, Clone)]
struct Prefs {
    active: String,
    zoom: f64,
    width: f64,
    height: f64,
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

#[derive(Serialize, Clone)]
struct Snapshot {
    sections: Vec<Section>,
    active: String,
    zoom: f64,
    notes_path: String,
    trusted: bool,
}

impl AppState {
    fn snapshot(&self) -> Snapshot {
        let prefs = self.prefs.lock().unwrap();
        Snapshot {
            sections: self.doc.lock().unwrap().sections.clone(),
            active: prefs.active.clone(),
            zoom: prefs.zoom,
            notes_path: self.notes_path.display().to_string(),
            trusted: trusted(),
        }
    }

    fn persist(&self) {
        if let Err(e) = self.doc.lock().unwrap().save(&self.notes_path) {
            eprintln!("jogpad: could not write {}: {e}", self.notes_path.display());
        }
        self.persist_prefs();
    }

    fn persist_prefs(&self) {
        if let Ok(json) = serde_json::to_string_pretty(&*self.prefs.lock().unwrap()) {
            let _ = std::fs::write(&self.prefs_path, json);
        }
    }
}

fn trusted() -> bool {
    #[cfg(target_os = "macos")]
    {
        selection::is_trusted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Every mutation funnels through here so the file on disk and the UI can
/// never disagree, no matter whether the change came from a click or a hotkey.
fn commit(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.persist();
    let _ = app.emit("notes", state.snapshot());
}

#[tauri::command]
fn snapshot(state: State<AppState>) -> Snapshot {
    state.snapshot()
}

#[tauri::command]
fn add_item(app: AppHandle, text: String, section: Option<String>) {
    let text = text.trim().to_string();
    if text.is_empty() {
        return;
    }
    {
        let state = app.state::<AppState>();
        let name = section.unwrap_or_else(|| state.prefs.lock().unwrap().active.clone());
        let mut doc = state.doc.lock().unwrap();
        doc.section_mut(&name).items.push(Item::new(text));
    }
    commit(&app);
}

#[tauri::command]
fn update_item(app: AppHandle, id: u64, text: String) {
    {
        let state = app.state::<AppState>();
        let mut doc = state.doc.lock().unwrap();
        // Clearing an item is how you delete it.
        if text.trim().is_empty() {
            doc.take_items(&[id]);
        } else if let Some(item) = doc.item_mut(id) {
            item.text = text;
        } else {
            return;
        }
    }
    commit(&app);
}

#[tauri::command]
fn toggle_item(app: AppHandle, id: u64) {
    {
        let state = app.state::<AppState>();
        let mut doc = state.doc.lock().unwrap();
        let Some(item) = doc.item_mut(id) else { return };
        item.done = !item.done;
    }
    commit(&app);
}

#[tauri::command]
fn delete_items(app: AppHandle, ids: Vec<u64>) {
    app.state::<AppState>()
        .doc
        .lock()
        .unwrap()
        .take_items(&ids);
    commit(&app);
}

#[tauri::command]
fn move_items(app: AppHandle, ids: Vec<u64>, section: String) {
    {
        let state = app.state::<AppState>();
        let mut doc = state.doc.lock().unwrap();
        let moved = doc.take_items(&ids);
        doc.section_mut(&section).items.extend(moved);
    }
    commit(&app);
}

/// Fold several items into the first one, keeping its position and its
/// checkbox state.
#[tauri::command]
fn merge_items(app: AppHandle, ids: Vec<u64>) {
    {
        let state = app.state::<AppState>();
        let mut doc = state.doc.lock().unwrap();
        let ordered: Vec<u64> = doc.items_in_order(&ids).iter().map(|i| i.id).collect();
        if ordered.len() < 2 {
            return;
        }
        let text = doc
            .items_in_order(&ids)
            .iter()
            .map(|i| i.text.clone())
            .collect::<Vec<_>>()
            .join("\n\n");
        let keep = ordered[0];
        doc.take_items(&ordered[1..]);
        if let Some(item) = doc.item_mut(keep) {
            item.text = text;
        }
    }
    commit(&app);
}

#[tauri::command]
fn set_active(app: AppHandle, section: String) {
    {
        let state = app.state::<AppState>();
        state.doc.lock().unwrap().section_mut(&section);
        state.prefs.lock().unwrap().active = section;
    }
    commit(&app);
}

#[tauri::command]
fn rename_section(app: AppHandle, from: String, to: String) {
    let to = to.trim().to_string();
    if to.is_empty() {
        return;
    }
    {
        let state = app.state::<AppState>();
        let mut doc = state.doc.lock().unwrap();
        if doc.sections.iter().any(|s| s.name == to) {
            return;
        }
        if let Some(s) = doc.sections.iter_mut().find(|s| s.name == from) {
            s.name = to.clone();
        }
        let mut prefs = state.prefs.lock().unwrap();
        if prefs.active == from {
            prefs.active = to;
        }
    }
    commit(&app);
}

#[tauri::command]
fn delete_section(app: AppHandle, section: String) {
    {
        let state = app.state::<AppState>();
        let mut doc = state.doc.lock().unwrap();
        doc.sections.retain(|s| s.name != section);
        if doc.sections.is_empty() {
            doc.section_mut(DEFAULT_SECTION);
        }
        let first = doc.sections[0].name.clone();
        let mut prefs = state.prefs.lock().unwrap();
        if prefs.active == section {
            prefs.active = first;
        }
    }
    commit(&app);
}

/// The whole point of the app: several items, one numbered list, ready to paste.
#[tauri::command]
fn copy_as_list(app: AppHandle, ids: Vec<u64>) -> String {
    let state = app.state::<AppState>();
    let doc = state.doc.lock().unwrap();
    let items = doc.items_in_order(&ids);
    let text = if items.len() == 1 {
        items[0].text.clone()
    } else {
        items
            .iter()
            .enumerate()
            .map(|(i, item)| format!("{}. {}", i + 1, item.text.replace('\n', "\n   ")))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let _ = app.clipboard().write_text(text.clone());
    text
}

#[tauri::command]
fn request_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    {
        selection::request_trust()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
fn reveal_notes(app: AppHandle) {
    let path = app.state::<AppState>().notes_path.clone();
    let _ = tauri_plugin_opener::reveal_item_in_dir(path);
}

/// Hiding keeps the process alive, so double-tap Shift still captures into the
/// file while the sidebar is out of the way.
fn set_visible(app: &AppHandle, visible: bool) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if visible {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let _ = window.hide();
    }
}

fn is_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// The panel never activates the app, so the menu bar's Cmd+W may never fire.
/// The front end sends the shortcut here instead.
#[tauri::command]
fn hide_window(app: AppHandle) {
    set_visible(&app, false);
}

/// Zoom scales the window along with the content, so a zoomed-in panel shows
/// the same amount of text at a larger size rather than less text.
#[tauri::command]
fn set_zoom(app: AppHandle, zoom: f64) {
    // Round, or repeated steps drift into 1.2000000000000002.
    let zoom = (zoom.clamp(0.6, 2.0) * 100.0).round() / 100.0;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let state = app.state::<AppState>();

    // Scale by the ratio rather than off a fixed base, so a window the user
    // dragged to a new size keeps that size through a zoom change.
    let (ratio, width, height) = {
        let mut prefs = state.prefs.lock().unwrap();
        let ratio = zoom / prefs.zoom;
        prefs.zoom = zoom;
        prefs.width *= ratio;
        prefs.height *= ratio;
        (ratio, prefs.width, prefs.height)
    };
    if (ratio - 1.0).abs() > f64::EPSILON {
        let _ = window.set_size(LogicalSize::new(width, height));
    }
    let _ = window.set_zoom(zoom);
    state.persist_prefs();
    let _ = app.emit("notes", state.snapshot());
}

/// An accessory app has no menu bar, so there is no system Quit item.
#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[cfg(target_os = "macos")]
fn spawn_hotkey_listener(app: AppHandle) {
    use std::sync::mpsc::channel;

    let (tx, rx) = channel();

    // CGEventTapCreate returns null without Accessibility access, and the
    // grant almost always arrives after launch. Installing the tap once at
    // startup meant it silently never existed until the next restart, which
    // looks exactly like the permission not working. So wait for the grant,
    // then install, and try again if the tap ever goes away.
    std::thread::spawn({
        let app = app.clone();
        move || loop {
            while !selection::is_trusted() {
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
            // Clears the "needs Accessibility" banner without a restart.
            let _ = app.emit("notes", app.state::<AppState>().snapshot());

            // Blocks on its own CFRunLoop while the tap is alive.
            hotkey::listen(tx.clone());
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    });

    std::thread::spawn(move || {
        while let Ok(gesture) = rx.recv() {
            match gesture {
                hotkey::Gesture::LeftShiftDouble => {
                    let Some(text) = selection::current() else {
                        continue;
                    };
                    let state = app.state::<AppState>();
                    let name = state.prefs.lock().unwrap().active.clone();
                    state
                        .doc
                        .lock()
                        .unwrap()
                        .section_mut(&name)
                        .items
                        .push(Item::new(text));
                    commit(&app);
                    let _ = app.emit("captured", ());
                }
                hotkey::Gesture::RightShiftDouble => {
                    set_visible(&app, true);
                    let _ = app.emit("focus-input", ());
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Cmd+W comes from the default macOS menu. Closing would destroy the
        // window and leave the tray pointing at nothing, so hide instead.
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::Resized(size) => {
                let app = window.app_handle();
                let Some(state) = app.try_state::<AppState>() else {
                    return;
                };
                let scale = window.scale_factor().unwrap_or(1.0);
                let logical = size.to_logical::<f64>(scale);
                if logical.width < 1.0 || logical.height < 1.0 {
                    return; // minimised
                }
                let mut prefs = state.prefs.lock().unwrap();
                prefs.width = logical.width;
                prefs.height = logical.height;
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            add_item,
            update_item,
            toggle_item,
            delete_items,
            move_items,
            merge_items,
            set_active,
            rename_section,
            delete_section,
            copy_as_list,
            request_accessibility,
            reveal_notes,
            hide_window,
            quit,
            set_zoom,
        ])
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let notes_path = dir.join("notes.md");
            let prefs_path = dir.join("prefs.json");
            let legacy_active = dir.join("active");

            let doc = Doc::load(&notes_path);
            let mut prefs: Prefs = std::fs::read_to_string(&prefs_path)
                .ok()
                .and_then(|json| serde_json::from_str(&json).ok())
                .or_else(|| {
                    // Older builds kept only the section name, in its own file.
                    let active = std::fs::read_to_string(&legacy_active).ok()?;
                    let _ = std::fs::remove_file(&legacy_active);
                    Some(Prefs { active, ..Prefs::default() })
                })
                .unwrap_or_default();

            if !doc.sections.iter().any(|s| s.name == prefs.active) {
                prefs.active = doc.sections[0].name.clone();
            }
            prefs.zoom = prefs.zoom.clamp(0.6, 2.0);
            let restored = (prefs.zoom, prefs.width, prefs.height);

            app.manage(AppState {
                notes_path,
                prefs_path,
                doc: Mutex::new(doc),
                prefs: Mutex::new(prefs),
            });

            // Write the file straight away so "reveal in Finder" has something
            // to point at before the first capture.
            app.state::<AppState>().persist();

            let show = MenuItem::with_id(app, "show", "Show JogPad", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide JogPad", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            // A template image: macOS recolours it for light and dark menu bars,
            // so the full-colour app icon would look wrong up there.
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            let tray = TrayIconBuilder::new().icon(tray_icon);
            #[cfg(target_os = "macos")]
            let tray = tray.icon_as_template(true);
            tray
                .menu(&Menu::with_items(app, &[&show, &hide, &quit])?)
                // Left click toggles, right click opens the menu.
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        set_visible(app, !is_visible(app));
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => set_visible(app, true),
                    "hide" => set_visible(app, false),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            #[cfg(target_os = "macos")]
            {
                // No Dock icon, no menu bar takeover. It is a sidebar, not an app
                // you switch to.
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                if let Some(window) = app.get_webview_window("main") {
                    panel::convert(&window);
                }
                spawn_hotkey_listener(app.handle().clone());
            }

            // The window is created hidden so restoring size and zoom does not
            // play out as a visible jump on every launch.
            if let Some(window) = app.get_webview_window("main") {
                let (zoom, width, height) = restored;
                let _ = window.set_size(LogicalSize::new(width, height));
                let _ = window.set_zoom(zoom);
                let _ = window.center();
                let _ = window.show();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running JogPad");
}
