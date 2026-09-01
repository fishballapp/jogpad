mod commands;
mod state;
mod store;

#[cfg(target_os = "macos")]
mod capture;
#[cfg(target_os = "macos")]
mod hotkey;
#[cfg(target_os = "macos")]
mod panel;
#[cfg(target_os = "macos")]
mod selection;

use state::{AppState, Prefs};
use store::Doc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, LogicalSize, Manager};

pub(crate) fn input_monitoring() -> bool {
    #[cfg(target_os = "macos")]
    {
        hotkey::input_monitoring_granted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub(crate) fn trusted() -> bool {
    #[cfg(target_os = "macos")]
    {
        selection::is_trusted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Hiding keeps the process alive, so double-tap Shift still captures into the
/// file while the sidebar is out of the way.
pub(crate) fn set_visible(app: &AppHandle, visible: bool) {
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

/// Whether the panel is the key window, i.e. whether typing lands in JogPad.
pub(crate) fn has_focus(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| Some(w.is_visible().ok()? && w.is_focused().ok()?))
        .unwrap_or(false)
}

pub(crate) fn is_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// Reads notes and preferences off disk. A missing notes file is an empty
/// document; anything else leaves the app read-only rather than letting the
/// next capture write emptiness over a file it could not read.
fn load_state(app: &AppHandle) -> tauri::Result<AppState> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let notes_path = dir.join("notes.md");
    let prefs_path = dir.join("prefs.json");
    let legacy_active = dir.join("active");

    let (doc, load_error) = match Doc::load(&notes_path) {
        Ok(doc) => (doc, None),
        Err(e) => (
            Doc::parse(""),
            Some(format!("Could not read {}: {e}", notes_path.display())),
        ),
    };

    let mut prefs: Prefs = std::fs::read_to_string(&prefs_path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .or_else(|| {
            // Older builds kept only the page name, in its own file.
            let active = std::fs::read_to_string(&legacy_active).ok()?;
            let _ = std::fs::remove_file(&legacy_active);
            Some(Prefs {
                active,
                ..Prefs::default()
            })
        })
        .unwrap_or_default();

    if !doc.pages.iter().any(|s| s.name == prefs.active) {
        prefs.active = doc.pages[0].name.clone();
    }
    prefs.zoom = prefs.zoom.clamp(0.6, 2.0);

    let state = AppState::new(notes_path, prefs_path, doc, prefs);
    if let Some(message) = load_error {
        eprintln!("jogpad: {message}");
        state.mark_unreadable(message);
    }
    Ok(state)
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show JogPad", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide JogPad", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    // A template image: macOS recolours it for light and dark menu bars, so
    // the full-colour app icon would look wrong up there.
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    let tray = TrayIconBuilder::new().icon(tray_icon);
    #[cfg(target_os = "macos")]
    let tray = tray.icon_as_template(true);

    tray.menu(&Menu::with_items(app, &[&show, &hide, &quit])?)
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
    Ok(())
}

fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    match event {
        // Cmd+W comes from the default macOS menu. Closing would destroy the
        // window and leave the tray pointing at nothing, so hide instead.
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window.hide();
        }
        // Coming back to the panel means any system dialog is done with.
        tauri::WindowEvent::Focused(true) => {
            #[cfg(target_os = "macos")]
            panel::restore_floating(window.app_handle());
        }
        tauri::WindowEvent::Resized(size) => {
            // Only the panel's size is a preference. Without this, resizing
            // the settings window would overwrite the panel's saved size.
            if window.label() != "main" {
                return;
            }
            let app = window.app_handle();
            let Some(state) = app.try_state::<AppState>() else {
                return;
            };
            let scale = window.scale_factor().unwrap_or(1.0);
            let logical = size.to_logical::<f64>(scale);
            if logical.width < 1.0 || logical.height < 1.0 {
                return; // minimised
            }
            let changed = state.with(|m| {
                if m.prefs.width == logical.width && m.prefs.height == logical.height {
                    return false;
                }
                m.prefs.width = logical.width;
                m.prefs.height = logical.height;
                true
            });
            // Quitting does not flush anything, so a resize with no following
            // edit would otherwise be forgotten.
            if changed {
                state.save_prefs();
            }
        }
        _ => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::snapshot,
            commands::add_item,
            commands::update_item,
            commands::toggle_item,
            commands::set_done,
            commands::delete_items,
            commands::move_items_before,
            commands::set_check_on_copy,
            commands::set_group_done,
            commands::move_items,
            commands::merge_items,
            commands::set_active,
            commands::rename_page,
            commands::delete_page,
            commands::copy_as_list,
            commands::request_permissions,
            commands::reveal_notes,
            commands::hide_window,
            commands::open_settings,
            commands::toggle_window,
            commands::quit,
            commands::set_zoom,
            commands::set_update_channel,
            commands::check_update,
            commands::install_update,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let state = load_state(&handle)?;

            // Create the file so "reveal in Finder" has a target, but never
            // rewrite one that already exists. Doc::parse drops markdown it
            // does not model, so writing on launch would silently delete
            // anything a person had added by hand.
            let create_notes = !state.notes_path.exists();
            app.manage(commands::PendingUpdate::default());
            app.manage(state);
            {
                let state = handle.state::<AppState>();
                if create_notes {
                    state.save();
                } else {
                    state.save_prefs();
                }
            }

            build_tray(&handle)?;

            #[cfg(target_os = "macos")]
            {
                // No Dock icon, no menu bar takeover. It is a sidebar, not an
                // app you switch to.
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                if let Some(window) = app.get_webview_window("main") {
                    panel::convert(&window);
                }
                capture::spawn(handle.clone());
            }

            // The window is created hidden so restoring size and zoom does not
            // play out as a visible jump on every launch.
            if let Some(window) = app.get_webview_window("main") {
                let (zoom, width, height) = handle
                    .state::<AppState>()
                    .with(|m| (m.prefs.zoom, m.prefs.width, m.prefs.height));
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
