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

use state::{AppState, WindowState};
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

/// The page toggles its own dark class; this covers what the page cannot
/// reach, such as the settings window's title bar and native menus.
pub(crate) fn apply_native_theme(app: &AppHandle, theme: &str) -> Result<(), String> {
    let native = match theme {
        "dark" => Some(tauri::Theme::Dark),
        "light" => Some(tauri::Theme::Light),
        "system" => None,
        _ => return Err(format!("Unknown theme: {theme}")),
    };
    for label in ["main", "settings"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.set_theme(native);
        }
    }
    Ok(())
}

/// Whether typing lands in JogPad, in either the panel or settings.
pub(crate) fn has_focus(app: &AppHandle) -> bool {
    ["main", "settings"].into_iter().any(|label| {
        app.get_webview_window(label)
            .and_then(|w| Some(w.is_visible().ok()? && w.is_focused().ok()?))
            .unwrap_or(false)
    })
}

pub(crate) fn is_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// Reads window state off disk. If window.json is missing, fall back to
/// width, height, zoom from prefs.json (older builds kept them there),
/// else defaults. Theme is peeked from prefs.json for native window setup.
fn load_state(app: &AppHandle) -> tauri::Result<(AppState, String)> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    let window_path = dir.join("window.json");
    let prefs_path = dir.join("prefs.json");

    let window_val: Option<serde_json::Value> = std::fs::read_to_string(&window_path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok());

    let prefs_val: Option<serde_json::Value> = std::fs::read_to_string(&prefs_path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok());

    let (width, height, zoom) = if let Some(w) = window_val {
        let width = w.get("width").and_then(|v| v.as_f64()).unwrap_or(380.0);
        let height = w.get("height").and_then(|v| v.as_f64()).unwrap_or(720.0);
        let zoom = w.get("zoom").and_then(|v| v.as_f64()).unwrap_or(1.0);
        (width, height, zoom)
    } else if let Some(p) = prefs_val.as_ref() {
        let width = p.get("width").and_then(|v| v.as_f64()).unwrap_or(380.0);
        let height = p.get("height").and_then(|v| v.as_f64()).unwrap_or(720.0);
        let zoom = p.get("zoom").and_then(|v| v.as_f64()).unwrap_or(1.0);
        (width, height, zoom)
    } else {
        (380.0, 720.0, 1.0)
    };

    let zoom = zoom.clamp(0.6, 2.0);
    let theme = match prefs_val
        .as_ref()
        .and_then(|p| p.get("theme"))
        .and_then(|t| t.as_str())
    {
        Some("light") => "light",
        Some("system") => "system",
        _ => "dark",
    };

    let state = AppState::new(
        dir,
        WindowState {
            width,
            height,
            zoom,
        },
    );
    Ok((state, theme.to_string()))
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
            let _ = state.update_size(logical.width, logical.height);
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
            commands::fs_read,
            commands::fs_write,
            commands::fs_describe,
            commands::fs_reveal,
            commands::permissions,
            commands::request_permissions,
            commands::show_window,
            commands::hide_window,
            commands::quit,
            commands::open_settings,
            commands::set_zoom,
            commands::set_theme,
            commands::check_update,
            commands::install_update,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let (state, theme) = load_state(&handle)?;

            app.manage(commands::PendingUpdate::default());
            app.manage(state);

            build_tray(&handle)?;

            #[cfg(target_os = "macos")]
            {
                // No Dock icon, no menu bar takeover. It is a sidebar, not an
                // app you switch to.
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                if let Some(window) = app.get_webview_window("main") {
                    panel::convert(&window, panel::NS_FLOATING_WINDOW_LEVEL);
                }
                // Same panel treatment as the sidebar. Joining all Spaces was
                // not enough on its own: showing a plain NSWindow activates
                // the app, and that activation is what drops you out of a
                // full-screen Space onto the desktop to find the window.
                // One level up, so showing the pad never buries settings.
                if let Some(window) = app.get_webview_window("settings") {
                    panel::convert(&window, panel::NS_FLOATING_WINDOW_LEVEL + 1);
                }
                capture::spawn(handle.clone());
            }

            // The window is created hidden so restoring size and zoom does not
            // play out as a visible jump on every launch.
            if let Some(window) = app.get_webview_window("main") {
                let WindowState {
                    width,
                    height,
                    zoom,
                } = handle.state::<AppState>().window();
                let _ = apply_native_theme(&handle, &theme);
                let _ = window.set_size(LogicalSize::new(width, height));
                let _ = window.set_zoom(zoom);
                let _ = window.center();
                let _ = window.show();
                if let Some(settings) = app.get_webview_window("settings") {
                    let _ = settings.set_zoom(zoom);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running JogPad");
}
