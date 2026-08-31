//! Turn Tauri's NSWindow into a non-activating NSPanel.
//!
//! A normal window activates the app when it is shown, which yanks focus out
//! of whatever you were reading. NSPanel with the non-activating style mask
//! floats above other apps and can still take key input for its text field,
//! without making JogPad the frontmost app.

use objc2::runtime::{AnyClass, AnyObject};
use objc2::{class, msg_send};

extern "C" {
    fn object_setClass(obj: *mut AnyObject, cls: *const AnyClass) -> *mut AnyObject;
}

const NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL: usize = 1 << 7;
const NS_FLOATING_WINDOW_LEVEL: isize = 3;
const NS_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const NS_COLLECTION_BEHAVIOR_FULL_SCREEN_AUXILIARY: usize = 1 << 8;

pub fn convert(window: &tauri::WebviewWindow) {
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    let ptr = ptr as *mut AnyObject;

    unsafe {
        // NSPanel adds no instance variables over NSWindow, so swapping the
        // class on a live object is safe. This is what tauri-nspanel does too.
        object_setClass(ptr, class!(NSPanel));

        let mask: usize = msg_send![ptr, styleMask];
        let _: () = msg_send![ptr, setStyleMask: mask | NS_WINDOW_STYLE_MASK_NONACTIVATING_PANEL];

        // Without this the panel can never take key input, so the prompt input
        // would be unusable. "Only if needed" means clicking the list does not
        // steal focus, but clicking the text field does.
        let _: () = msg_send![ptr, setBecomesKeyOnlyIfNeeded: true];
        let _: () = msg_send![ptr, setFloatingPanel: true];
        let _: () = msg_send![ptr, setHidesOnDeactivate: false];
        let _: () = msg_send![ptr, setLevel: NS_FLOATING_WINDOW_LEVEL];
        let _: () = msg_send![
            ptr,
            setCollectionBehavior: NS_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES
                | NS_COLLECTION_BEHAVIOR_FULL_SCREEN_AUXILIARY
        ];
    }
}
