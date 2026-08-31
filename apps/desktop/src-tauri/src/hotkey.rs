//! Double-tap Shift, detected with a listen-only CoreGraphics event tap.
//!
//! The global-shortcut plugin cannot express this: a bare modifier is not an
//! accelerator. So we watch `flagsChanged` directly and time the presses.

use core_foundation::base::TCFType;
use core_foundation::mach_port::CFMachPortRef;
use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_graphics::event::{
    CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
    CGEventType, CallbackResult, EventField,
};
use std::cell::Cell;
use std::sync::mpsc::Sender;
use std::sync::Mutex;
use std::time::{Duration, Instant};

extern "C" {
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
}

// Watching the keyboard is gated on Input Monitoring, which is a different
// TCC service from Accessibility. AXIsProcessTrusted says nothing about it,
// and a tap created without it is handed back looking healthy but never
// receives an event.
#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOHIDCheckAccess(request: u32) -> u32;
    fn IOHIDRequestAccess(request: u32) -> bool;
}

const LISTEN_EVENT: u32 = 1;
const ACCESS_GRANTED: u32 = 0;

pub fn input_monitoring_granted() -> bool {
    unsafe { IOHIDCheckAccess(LISTEN_EVENT) == ACCESS_GRANTED }
}

/// Shows the system prompt the first time. Later calls just report status.
pub fn request_input_monitoring() -> bool {
    unsafe { IOHIDRequestAccess(LISTEN_EVENT) }
}

thread_local! {
    static TAP_PORT: Cell<CFMachPortRef> = const { Cell::new(std::ptr::null_mut()) };
}

const KEYCODE_LEFT_SHIFT: i64 = 56;
const KEYCODE_RIGHT_SHIFT: i64 = 60;

// The device-dependent half of CGEventFlags tells the two Shift keys apart.
// Reading the generic shift bit instead would misread "release left while
// right is held" as a fresh press.
const MASK_LEFT_SHIFT: u64 = 0x0000_0002;
const MASK_RIGHT_SHIFT: u64 = 0x0000_0004;

const OTHER_MODIFIERS: u64 = CGEventFlags::CGEventFlagCommand.bits()
    | CGEventFlags::CGEventFlagControl.bits()
    | CGEventFlags::CGEventFlagAlternate.bits();

const DOUBLE_TAP_WINDOW: Duration = Duration::from_millis(400);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gesture {
    /// Capture whatever is selected in the frontmost app.
    LeftShiftDouble,
    /// Bring JogPad's input forward so you can type a thought.
    RightShiftDouble,
}

#[derive(Default)]
struct Detector {
    last_key: Option<i64>,
    last_at: Option<Instant>,
}

impl Detector {
    fn reset(&mut self) {
        self.last_key = None;
        self.last_at = None;
    }

    fn press(&mut self, keycode: i64) -> Option<Gesture> {
        let now = Instant::now();
        let repeat = self.last_key == Some(keycode)
            && self
                .last_at
                .is_some_and(|t| now.duration_since(t) < DOUBLE_TAP_WINDOW);

        if repeat {
            self.reset();
            return Some(match keycode {
                KEYCODE_RIGHT_SHIFT => Gesture::RightShiftDouble,
                _ => Gesture::LeftShiftDouble,
            });
        }

        self.last_key = Some(keycode);
        self.last_at = Some(now);
        None
    }
}

/// Blocks forever. Run it on its own thread; it needs a CFRunLoop of its own.
pub fn listen(tx: Sender<Gesture>) {
    let detector = Mutex::new(Detector::default());

    let tap = CGEventTap::new(
        CGEventTapLocation::HID,
        CGEventTapPlacement::HeadInsertEventTap,
        // Listen-only. A default tap can swallow events, and swallowing Shift
        // breaks every capital letter on the system.
        CGEventTapOptions::ListenOnly,
        // Only real event types belong here. The tap-disabled events arrive at
        // the callback regardless, and listing them overflows the mask the
        // crate builds with `1 << event_type`.
        vec![CGEventType::FlagsChanged, CGEventType::KeyDown],
        move |_proxy, etype, event| {
            match etype {
                CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput => {
                    let port = TAP_PORT.with(|p| p.get());
                    if !port.is_null() {
                        unsafe { CGEventTapEnable(port, true) };
                    }
                }
                CGEventType::KeyDown => {
                    // Shift, A, Shift is typing, not a gesture.
                    detector.lock().unwrap().reset();
                }
                CGEventType::FlagsChanged => {
                    let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
                    let bits = event.get_flags().bits();

                    let mask = match keycode {
                        KEYCODE_LEFT_SHIFT => MASK_LEFT_SHIFT,
                        KEYCODE_RIGHT_SHIFT => MASK_RIGHT_SHIFT,
                        _ => {
                            detector.lock().unwrap().reset();
                            return CallbackResult::Keep;
                        }
                    };

                    if bits & OTHER_MODIFIERS != 0 {
                        detector.lock().unwrap().reset();
                        return CallbackResult::Keep;
                    }

                    // Only the press edge counts; the release is the same event type.
                    if bits & mask != 0 {
                        if let Some(gesture) = detector.lock().unwrap().press(keycode) {
                            let _ = tx.send(gesture);
                        }
                    }
                }
                _ => {}
            }
            CallbackResult::Keep
        },
    );

    let Ok(tap) = tap else {
        eprintln!("jogpad: could not install the event tap, retrying.");
        return;
    };

    TAP_PORT.with(|p| p.set(tap.mach_port().as_concrete_TypeRef()));

    let source = tap
        .mach_port()
        .create_runloop_source(0)
        .expect("runloop source");
    CFRunLoop::get_current().add_source(&source, unsafe { kCFRunLoopCommonModes });
    tap.enable();
    CFRunLoop::run_current();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_taps_of_the_same_key_fire() {
        let mut d = Detector::default();
        assert_eq!(d.press(KEYCODE_LEFT_SHIFT), None);
        assert_eq!(d.press(KEYCODE_LEFT_SHIFT), Some(Gesture::LeftShiftDouble));
        // State cleared, so a third tap is a fresh first tap.
        assert_eq!(d.press(KEYCODE_LEFT_SHIFT), None);
    }

    #[test]
    fn left_then_right_is_not_a_double_tap() {
        let mut d = Detector::default();
        assert_eq!(d.press(KEYCODE_LEFT_SHIFT), None);
        assert_eq!(d.press(KEYCODE_RIGHT_SHIFT), None);
        assert_eq!(d.press(KEYCODE_RIGHT_SHIFT), Some(Gesture::RightShiftDouble));
    }

    #[test]
    fn a_keystroke_between_taps_cancels() {
        let mut d = Detector::default();
        assert_eq!(d.press(KEYCODE_LEFT_SHIFT), None);
        d.reset();
        assert_eq!(d.press(KEYCODE_LEFT_SHIFT), None);
    }
}
