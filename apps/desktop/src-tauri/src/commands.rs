//! The Tauri command surface: effect commands called by the TypeScript host.

use crate::set_visible;
use crate::state::AppState;
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Serialize, Clone)]
struct FsChanged {
    name: String,
}

/// null when the file does not exist. Any other failure is an error the
/// front end turns into read-only mode rather than overwriting the file.
#[tauri::command]
pub fn fs_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let path = app.state::<AppState>().path(&name)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read {}: {e}", path.display())),
    }
}

/// Atomic write, then tell every window. The writer gets the event too and
/// ignores it by comparing text.
#[tauri::command]
pub fn fs_write(app: AppHandle, name: String, text: String) -> Result<(), String> {
    let path = app.state::<AppState>().path(&name)?;
    crate::store::write_atomic(&path, text.as_bytes())
        .map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    let _ = app.emit("fs-changed", FsChanged { name });
    Ok(())
}

/// Store bytes under their hash and answer with the ref the item writes.
/// The body is raw, the name rides in a header. Writing the same bytes twice
/// finds the file already there and leaves it alone.
#[tauri::command]
pub fn attachment_write(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw bytes".into());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_decode_str(v).decode_utf8_lossy().into_owned())
        .unwrap_or_default();
    let ext: String = name
        .rsplit_once('.')
        .map(|(_, e)| e)
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_ascii_lowercase();
    let ext = if ext.is_empty() {
        "bin".to_string()
    } else {
        ext
    };
    // Twelve hex digits of the hash: 48 bits is plenty for one person's
    // folder, and a full digest makes an ugly path in copied text.
    let hash = format!("{:x}", Sha256::digest(bytes));
    let attachment_ref = format!("attachments/{}.{ext}", &hash[..12]);
    let path = app.state::<AppState>().attachment_path(&attachment_ref)?;
    if !path.exists() {
        crate::store::write_atomic(&path, bytes)
            .map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    }
    Ok(attachment_ref)
}

#[tauri::command]
pub fn attachment_path(app: AppHandle, attachment_ref: String) -> Result<String, String> {
    let path = app.state::<AppState>().attachment_path(&attachment_ref)?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn attachment_reveal(app: AppHandle, attachment_ref: String) -> Result<(), String> {
    let path = app.state::<AppState>().attachment_path(&attachment_ref)?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

/// To the Trash, so a wrong removal is one Finder "Put Back" away. A file
/// that is already gone is not an error: the reference was the thing.
#[tauri::command]
pub fn attachment_remove(app: AppHandle, attachment_ref: String) -> Result<(), String> {
    let path = app.state::<AppState>().attachment_path(&attachment_ref)?;
    if !path.exists() {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSFileManager, NSString, NSURL};
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.display().to_string()));
        NSFileManager::defaultManager()
            .trashItemAtURL_resultingItemURL_error(&url, None)
            .map_err(|e| e.localizedDescription().to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

/// The picture itself on the pasteboard, decoded by AppKit so every format
/// it can read pastes as an image wherever images are accepted.
#[tauri::command]
pub fn attachment_copy_image(app: AppHandle, attachment_ref: String) -> Result<(), String> {
    let path = app.state::<AppState>().attachment_path(&attachment_ref)?;
    #[cfg(target_os = "macos")]
    {
        use objc2::rc::Retained;
        use objc2::runtime::ProtocolObject;
        use objc2::AnyThread;
        use objc2_app_kit::{NSImage, NSPasteboard, NSPasteboardWriting};
        use objc2_foundation::{NSArray, NSString};

        let file = NSString::from_str(&path.display().to_string());
        let image = NSImage::initWithContentsOfFile(NSImage::alloc(), &file)
            .ok_or_else(|| "That file is not an image macOS can read.".to_string())?;
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        let writable: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> =
            vec![ProtocolObject::from_retained(image)];
        if !pb.writeObjects(&NSArray::from_retained_slice(&writable)) {
            return Err("Could not write to the clipboard.".into());
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Copying images is only supported on macOS.".into())
    }
}

/// A window the size of the screen the pad is on, showing one attachment
/// over everything. Made once and then only hidden, like settings: closing
/// a window whose class was swapped to a panel aborts the process (seen on
/// 0.1.6-0.dev.53). Each open re-navigates it, so the page reads the URL once.
#[tauri::command]
pub fn open_preview(app: AppHandle, attachment_ref: String, name: String) -> Result<(), String> {
    app.state::<AppState>().attachment_path(&attachment_ref)?;
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "The pad's window is gone.".to_string())?;
    let monitor = main
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "No display to show it on.".to_string())?;
    let scale = monitor.scale_factor();
    let size = monitor.size().to_logical::<f64>(scale);
    let position = monitor.position().to_logical::<f64>(scale);
    let query = format!(
        "window=preview&ref={}&name={}",
        utf8_percent_encode(&attachment_ref, NON_ALPHANUMERIC),
        utf8_percent_encode(&name, NON_ALPHANUMERIC)
    );

    let window = match app.get_webview_window("preview") {
        Some(window) => {
            let mut url = window.url().map_err(|e| e.to_string())?;
            url.set_query(Some(&query));
            window.navigate(url).map_err(|e| e.to_string())?;
            let _ = window.set_position(tauri::LogicalPosition::new(position.x, position.y));
            let _ = window.set_size(LogicalSize::new(size.width, size.height));
            window
        }
        None => {
            let window = tauri::WebviewWindowBuilder::new(
                &app,
                "preview",
                tauri::WebviewUrl::App(format!("index.html?{query}").into()),
            )
            .title("Preview")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .position(position.x, position.y)
            .inner_size(size.width, size.height)
            .focused(true)
            .build()
            .map_err(|e| e.to_string())?;
            // Same treatment as settings, one level higher still, so it covers
            // the pad and shows inside full-screen Spaces without activating
            // the app.
            #[cfg(target_os = "macos")]
            crate::panel::convert(&window, crate::panel::NS_FLOATING_WINDOW_LEVEL + 2);
            window
        }
    };
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub fn fs_describe(app: AppHandle, name: String) -> Result<String, String> {
    let path = app.state::<AppState>().path(&name)?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn fs_reveal(app: AppHandle, name: String) -> Result<(), String> {
    let path = app.state::<AppState>().path(&name)?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct PermissionsStatus {
    pub trusted: bool,
    pub input_monitoring: bool,
}

#[tauri::command]
pub fn permissions() -> PermissionsStatus {
    PermissionsStatus {
        trusted: crate::trusted(),
        input_monitoring: crate::input_monitoring(),
    }
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
    let status = permissions();
    let _ = app.emit("permissions", status);
}

/// Bring the panel up. Without focus it is ordered in front but the keyboard
/// stays where it was (see panel::show_without_focus).
#[tauri::command]
pub fn show_window(app: AppHandle, focus: bool) {
    if focus {
        set_visible(&app, true);
        let _ = app.emit("focus-input", ());
    } else {
        #[cfg(target_os = "macos")]
        {
            crate::panel::show_without_focus(&app);
        }
        #[cfg(not(target_os = "macos"))]
        {
            set_visible(&app, true);
        }
    }
}

/// Make JogPad the active app. The pad is a non-activating panel, so a
/// native dialog it opens, such as the file picker, cannot become key until
/// something activates the app; without this it shows but takes no clicks.
#[tauri::command]
pub fn activate() {
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSApplication;
        if let Some(mtm) = MainThreadMarker::new() {
            #[allow(deprecated)]
            NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
        }
    }
}

/// The panel never activates the app, so the menu bar's Cmd+W may never fire.
/// The front end sends the shortcut here instead.
#[tauri::command]
pub fn hide_window(app: AppHandle) {
    set_visible(&app, false);
    // The next tap should bring back just the pad, not settings over it.
    if let Some(settings) = app.get_webview_window("settings") {
        let _ = settings.hide();
    }
    if let Some(preview) = app.get_webview_window("preview") {
        let _ = preview.hide();
    }
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

/// An accessory app has no menu bar, so there is no system Quit item.
#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

/// Zoom scales the window along with the content, so a zoomed-in panel shows
/// the same amount of text at a larger size rather than less text.
#[tauri::command]
pub fn set_zoom(app: AppHandle, zoom: f64) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let zoom = (zoom.clamp(0.6, 2.0) * 100.0).round() / 100.0;
    let state = app.state::<AppState>();
    let Ok((ratio, width, height, actual_zoom)) = state.set_zoom(zoom) else {
        return;
    };

    // Scale by the ratio rather than off a fixed base, so a window the user
    // dragged to a new size keeps that size through a zoom change.
    if (ratio - 1.0).abs() > f64::EPSILON {
        let _ = window.set_size(LogicalSize::new(width, height));
    }
    let _ = window.set_zoom(actual_zoom);
    // Content only: the settings window keeps its size and scrolls instead.
    if let Some(settings) = app.get_webview_window("settings") {
        let _ = settings.set_zoom(actual_zoom);
    }
}

#[tauri::command]
pub fn set_theme(app: AppHandle, theme: String) -> Result<(), String> {
    crate::apply_native_theme(&app, &theme)
}

/// The update found by the last check, tagged with the channel it came from.
/// The tag is what stops a switch to Beta installing a build that was found on
/// Stable: checks are network calls that can land out of order, so the channel
/// is compared against the live preference at install time rather than trusted
/// to still be whatever it was when the check started.
#[derive(Default)]
pub(crate) struct PendingUpdate(pub Mutex<Option<(String, Update)>>);

#[derive(Serialize, Clone, Debug)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

const STABLE_ENDPOINT: &str = "https://jogpad.fishball.app/latest.json";
const BETA_ENDPOINT: &str = "https://jogpad.fishball.app/beta.json";
const DEV_ENDPOINT: &str = "https://jogpad.fishball.app/dev.json";

fn endpoint_for_channel(channel: &str) -> Result<&'static str, String> {
    match channel {
        "stable" => Ok(STABLE_ENDPOINT),
        "beta" => Ok(BETA_ENDPOINT),
        "dev" => Ok(DEV_ENDPOINT),
        _ => Err(format!("Unknown update channel: {channel}")),
    }
}

#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    channel: String,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let endpoint_url = endpoint_for_channel(&channel)?;
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
    channel: String,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let _ = endpoint_for_channel(&channel)?;
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
