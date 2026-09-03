//! Turn Tauri's NSWindow into a non-activating NSPanel.
//!
//! A normal window activates the app when it is shown, which yanks focus out
//! of whatever you were reading. NSPanel with the non-activating style mask
//! floats above other apps and can still take key input for its text field,
//! without making JogPad the frontmost app.

use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::{class, msg_send, sel};
use std::sync::OnceLock;
use tauri::Manager;

extern "C" {
    fn object_setClass(obj: *mut AnyObject, cls: *const AnyClass) -> *mut AnyObject;
}

const NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL: usize = 1 << 7;
pub const NS_FLOATING_WINDOW_LEVEL: isize = 3;
const NS_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const NS_COLLECTION_BEHAVIOR_FULL_SCREEN_AUXILIARY: usize = 1 << 8;

/// Drop the panel to a normal level so a system dialog can appear above it,
/// and put it back afterwards. Nothing sits above a floating panel otherwise,
/// including the permission prompts JogPad itself asks for.
static LOWERED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Restore the floating level, but only if something actually lowered it.
/// Changing a window's level reorders it, and doing that while it is becoming
/// key knocks it straight back out, which makes the text fields unfocusable.
pub fn restore_floating(app: &tauri::AppHandle) {
    if LOWERED.swap(false, std::sync::atomic::Ordering::Relaxed) {
        set_floating(app, true);
    }
}

/// Callers include the hotkey thread and Tauri commands, so this hops to the
/// main thread rather than messaging AppKit from wherever it was called.
pub fn set_floating(app: &tauri::AppHandle, floating: bool) {
    LOWERED.store(!floating, std::sync::atomic::Ordering::Relaxed);
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let Ok(ptr) = window.ns_window() else {
            return;
        };
        let ptr = ptr as *mut AnyObject;
        let level = if floating {
            NS_FLOATING_WINDOW_LEVEL
        } else {
            0
        };
        unsafe {
            let _: () = msg_send![ptr, setFloatingPanel: floating];
            let _: () = msg_send![ptr, setLevel: level];
        }
    });
}

/// Show the panel without making it the key window. Tauri's `show` goes
/// through `makeKeyAndOrderFront:`, which would pull the keyboard out of
/// whatever you were reading when a capture fired.
pub fn show_without_focus(app: &tauri::AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let Ok(ptr) = window.ns_window() else {
            return;
        };
        unsafe {
            let _: () = msg_send![ptr as *mut AnyObject, orderFrontRegardless];
        }
    });
}

/// A borderless NSWindow answers NO to canBecomeKeyWindow, and stock NSPanel
/// does not override that. Swapping to plain NSPanel therefore produced a
/// window that could never take a keystroke, whatever the style mask said.
/// This subclass exists purely to answer YES.
fn panel_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        // A raw receiver rather than a reference: the reference form needs a
        // higher-ranked lifetime that cannot be written at the cast site.
        extern "C" fn can_become_key(_this: *mut AnyObject, _sel: Sel) -> Bool {
            Bool::YES
        }
        // Main window status belongs to real app windows. A panel taking it
        // is what makes an accessory app steal the menu bar.
        extern "C" fn can_become_main(_this: *mut AnyObject, _sel: Sel) -> Bool {
            Bool::NO
        }

        let mut builder = ClassBuilder::new(c"JogPadPanel", class!(NSPanel))
            .expect("JogPadPanel class name already taken");
        unsafe {
            builder.add_method(
                sel!(canBecomeKeyWindow),
                can_become_key as extern "C" fn(*mut AnyObject, Sel) -> Bool,
            );
            builder.add_method(
                sel!(canBecomeMainWindow),
                can_become_main as extern "C" fn(*mut AnyObject, Sel) -> Bool,
            );
        }
        builder.register()
    })
}

pub fn convert(window: &tauri::WebviewWindow, level: isize) {
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    let ptr = ptr as *mut AnyObject;

    unsafe {
        // Swapping the class of a live window. Neither NSPanel nor the
        // subclass adds instance variables over NSWindow, which is what makes
        // the memory layout compatible. That is necessary but not sufficient:
        // it does not prove the class Tauri built had no overrides worth
        // keeping. This is what tauri-nspanel does and it holds on Tauri 2.11
        // with macOS 15, so treat it as tested rather than proven, and suspect
        // it first if a Tauri upgrade breaks the window.
        object_setClass(ptr, panel_class());

        let mask: usize = msg_send![ptr, styleMask];
        let _: () = msg_send![ptr, setStyleMask: mask | NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL];

        // Changing the style mask resets the window to an opaque default
        // background, which paints square corners behind the rounded ones the
        // web view draws. Put the transparency back.
        let clear: *mut AnyObject = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ptr, setOpaque: false];
        let _: () = msg_send![ptr, setBackgroundColor: clear];

        // "Only if needed" asks the clicked view whether it needs key status
        // via needsPanelToBecomeKey. NSTextField says yes; WKWebView does not
        // override it and says no, so nothing inside the web view could ever
        // take a keystroke. Clicking the panel now makes it key, which is what
        // you want when you click into the composer. The non-activating mask
        // still stops JogPad becoming the frontmost app, and capture never
        // focuses the window at all, so neither is affected.
        let _: () = msg_send![ptr, setBecomesKeyOnlyIfNeeded: false];
        let _: () = msg_send![ptr, setFloatingPanel: true];
        let _: () = msg_send![ptr, setHidesOnDeactivate: false];
        let _: () = msg_send![ptr, setLevel: level];
    }
    join_all_spaces(window);
}

/// Show on every Space, including over a full-screen app. Without this a
/// window opened while a full-screen app is up appears on the desktop Space
/// instead, and macOS swaps you over to it, or leaves it out of sight.
pub fn join_all_spaces(window: &tauri::WebviewWindow) {
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    unsafe {
        let _: () = msg_send![
            ptr as *mut AnyObject,
            setCollectionBehavior: NS_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES
                | NS_COLLECTION_BEHAVIOR_FULL_SCREEN_AUXILIARY
        ];
    }
}
