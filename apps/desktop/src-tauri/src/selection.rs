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
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::{CFString, CFStringRef};
use core_graphics::event::{CGEventFlags, CGEventTapLocation, CGEventType};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardTypeString, NSPasteboardWriting};
use objc2_foundation::NSArray;
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
    let err =
        unsafe { AXUIElementCopyAttributeValue(element, name.as_concrete_TypeRef(), &mut value) };
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

/// A deep copy of everything on the pasteboard, every item and every
/// representation. Saving just the string would quietly downgrade a copied
/// image, file or styled text to plain text on every capture.
fn snapshot_pasteboard(pb: &NSPasteboard) -> Vec<Retained<NSPasteboardItem>> {
    let mut saved = Vec::new();
    let Some(items) = pb.pasteboardItems() else {
        return saved;
    };
    for item in items.iter() {
        let copy = NSPasteboardItem::new();
        for kind in item.types().iter() {
            // Promised types have no data yet and cannot be carried over.
            if let Some(data) = item.dataForType(&kind) {
                copy.setData_forType(&data, &kind);
            }
        }
        saved.push(copy);
    }
    saved
}

fn restore_pasteboard(pb: &NSPasteboard, saved: Vec<Retained<NSPasteboardItem>>) {
    pb.clearContents();
    if saved.is_empty() {
        return;
    }
    let writable: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> = saved
        .into_iter()
        .map(ProtocolObject::from_retained)
        .collect();
    pb.writeObjects(&NSArray::from_retained_slice(&writable));
}

/// Press Cmd+C for the user, read what landed, then put the clipboard back.
fn synthetic_copy() -> Option<String> {
    let pb = NSPasteboard::generalPasteboard();
    let before_count = pb.changeCount();
    let saved = snapshot_pasteboard(&pb);

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

    // Only put things back if the change we are undoing is still the most
    // recent one. Another app may have written to the pasteboard while we
    // were polling, and clobbering that would be worse than leaving ours.
    if copied.is_some() && pb.changeCount() == before_count + 1 {
        restore_pasteboard(&pb, saved);
    }
    copied
}
