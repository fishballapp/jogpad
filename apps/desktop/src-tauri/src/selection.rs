//! Reading the selection out of whatever app is in front.
//!
//! Two mechanisms, because neither one covers everything. The Accessibility
//! API is clean and free of side effects but returns nothing in apps that do
//! not publish an accessibility tree. Synthesising Cmd+C works nearly
//! everywhere but costs a clipboard round trip, so it is the fallback.

use accessibility_sys::{
    kAXErrorSuccess, kAXFocusedUIElementAttribute, kAXSelectedTextAttribute,
    kAXTrustedCheckOptionPrompt, AXIsProcessTrusted, AXIsProcessTrustedWithOptions,
    AXUIElementCopyAttributeValue, AXUIElementCreateSystemWide, AXUIElementRef,
};
use core_foundation::base::{CFRelease, CFType, CFTypeRef, TCFType};
use core_foundation::dictionary::CFDictionary;
use core_foundation::boolean::CFBoolean;
use core_foundation::string::{CFString, CFStringRef};
use core_graphics::event::{CGEventFlags, CGEventTapLocation, CGEventType};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
use objc2_foundation::NSString;
use std::time::Duration;

const KEYCODE_C: u16 = 8;

pub fn is_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Shows the system prompt if access has not been granted yet.
pub fn request_trust() -> bool {
    unsafe {
        let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
        let options = CFDictionary::from_CFType_pairs(&[(
            key.as_CFType(),
            CFBoolean::true_value().as_CFType(),
        )]);
        AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef())
    }
}

pub fn current() -> Option<String> {
    accessibility_selection()
        .or_else(synthetic_copy)
        .filter(|s| !s.trim().is_empty())
}

fn copy_attribute(element: AXUIElementRef, attribute: &str) -> Option<CFTypeRef> {
    let name = CFString::new(attribute);
    let mut value: CFTypeRef = std::ptr::null();
    let err = unsafe {
        AXUIElementCopyAttributeValue(element, name.as_concrete_TypeRef(), &mut value)
    };
    if err != kAXErrorSuccess || value.is_null() {
        return None;
    }
    Some(value)
}

fn accessibility_selection() -> Option<String> {
    unsafe {
        let system = AXUIElementCreateSystemWide();
        if system.is_null() {
            return None;
        }
        let focused = copy_attribute(system, kAXFocusedUIElementAttribute);
        CFRelease(system as CFTypeRef);
        let focused = focused?;

        let selected = copy_attribute(focused as AXUIElementRef, kAXSelectedTextAttribute);
        CFRelease(focused);
        let selected = selected?;

        // The attribute is documented as a string, but a misbehaving app can
        // hand back anything, and blindly casting it would be a crash.
        let value = CFType::wrap_under_create_rule(selected);
        if !value.instance_of::<CFString>() {
            return None;
        }
        let text = CFString::wrap_under_get_rule(value.as_CFTypeRef() as CFStringRef).to_string();
        (!text.trim().is_empty()).then_some(text)
    }
}

fn pasteboard_string(pb: &NSPasteboard) -> Option<String> {
    unsafe { pb.stringForType(NSPasteboardTypeString) }.map(|s| s.to_string())
}

/// Press Cmd+C for the user, read what landed, then put the clipboard back.
fn synthetic_copy() -> Option<String> {
    unsafe {
        let pb = NSPasteboard::generalPasteboard();
        let before_count = pb.changeCount();
        let before_text = pasteboard_string(&pb);

        let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?;
        for down in [true, false] {
            let event =
                core_graphics::event::CGEvent::new_keyboard_event(source.clone(), KEYCODE_C, down)
                    .ok()?;
            event.set_flags(CGEventFlags::CGEventFlagCommand);
            event.post(CGEventTapLocation::HID);
        }
        let _ = CGEventType::KeyDown;

        // The target app copies asynchronously, so poll rather than guess.
        let mut copied = None;
        for _ in 0..20 {
            std::thread::sleep(Duration::from_millis(15));
            if pb.changeCount() != before_count {
                copied = pasteboard_string(&pb);
                break;
            }
        }

        // Best effort. The pasteboard is shared global state and another app
        // may have written to it while we were waiting.
        if copied.is_some() {
            if let Some(previous) = before_text {
                pb.clearContents();
                pb.setString_forType(&NSString::from_str(&previous), NSPasteboardTypeString);
            }
        }
        copied
    }
}
