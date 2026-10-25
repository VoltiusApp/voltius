//! Native iOS bits the WebView cannot do itself: haptic feedback and the system
//! share sheet for files. Both call UIKit through the Objective-C runtime (UIKit is
//! always linked in the iOS app), on the main thread. Elsewhere the commands are
//! no-ops that report `false`, so the frontend can call them unconditionally.

use tauri::AppHandle;

/// Play one of the `HapticKind`s of src/lib/haptics.ts. False when unsupported.
#[tauri::command]
pub fn haptic_perform(app: AppHandle, kind: String) -> bool {
    #[cfg(target_os = "ios")]
    {
        app.run_on_main_thread(move || imp::haptic(&kind)).is_ok()
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, kind);
        false
    }
}

/// Open the share sheet for local files (absolute paths). False when unsupported.
#[tauri::command]
pub fn share_files_native(app: AppHandle, paths: Vec<String>) -> bool {
    #[cfg(target_os = "ios")]
    {
        if paths.is_empty() {
            return false;
        }
        app.run_on_main_thread(move || imp::share_files(&paths))
            .is_ok()
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, paths);
        false
    }
}

/// Hide the bar iOS shows above the keyboard for web inputs (previous / next /
/// done). The terminal has its own extra-keys row right there, and the bar
/// pushes it up. Same trick as Capacitor's Keyboard plugin: WKContentView's
/// `inputAccessoryView` returns nil. Call once, on the main thread.
#[cfg(target_os = "ios")]
pub fn hide_keyboard_accessory_bar() {
    use std::ffi::{c_char, c_void};

    extern "C" {
        fn objc_getClass(name: *const c_char) -> *mut c_void;
        fn sel_registerName(name: *const c_char) -> *const c_void;
        fn class_replaceMethod(
            cls: *mut c_void,
            name: *const c_void,
            imp: *const c_void,
            types: *const c_char,
        ) -> *const c_void;
    }

    extern "C" fn no_accessory(_this: *mut c_void, _cmd: *const c_void) -> *mut c_void {
        std::ptr::null_mut()
    }

    unsafe {
        let cls = objc_getClass(c"WKContentView".as_ptr());
        if cls.is_null() {
            log::warn!("WKContentView not found: keyboard accessory bar stays");
            return;
        }
        let sel = sel_registerName(c"inputAccessoryView".as_ptr());
        class_replaceMethod(cls, sel, no_accessory as *const c_void, c"@@:".as_ptr());
    }
}

#[cfg(target_os = "ios")]
mod imp {
    use block2::Block;
    use objc2::msg_send;
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::{NSArray, NSString};

    // UIImpactFeedbackStyle / UINotificationFeedbackType raw values.
    const IMPACT_LIGHT: isize = 0;
    const IMPACT_MEDIUM: isize = 1;
    const IMPACT_RIGID: isize = 4;
    const NOTIFY_SUCCESS: isize = 0;
    const NOTIFY_ERROR: isize = 2;

    enum Feedback {
        Impact(isize),
        Notification(isize),
        Selection,
    }

    fn feedback_for(kind: &str) -> Option<Feedback> {
        Some(match kind {
            "key" => Feedback::Impact(IMPACT_LIGHT),
            "tick" | "toggleOn" | "toggleOff" => Feedback::Selection,
            "press" => Feedback::Impact(IMPACT_MEDIUM),
            "gesture" => Feedback::Impact(IMPACT_RIGID),
            "confirm" => Feedback::Notification(NOTIFY_SUCCESS),
            "reject" => Feedback::Notification(NOTIFY_ERROR),
            _ => return None,
        })
    }

    fn class(name: &std::ffi::CStr) -> Option<&'static AnyClass> {
        AnyClass::get(name)
    }

    pub fn haptic(kind: &str) {
        let Some(feedback) = feedback_for(kind) else {
            return;
        };
        unsafe {
            match feedback {
                Feedback::Impact(style) => {
                    let Some(cls) = class(c"UIImpactFeedbackGenerator") else {
                        return;
                    };
                    let obj: Allocated<AnyObject> = msg_send![cls, alloc];
                    let generator: Retained<AnyObject> = msg_send![obj, initWithStyle: style];
                    let _: () = msg_send![&*generator, impactOccurred];
                }
                Feedback::Notification(kind) => {
                    let Some(cls) = class(c"UINotificationFeedbackGenerator") else {
                        return;
                    };
                    let generator: Retained<AnyObject> = msg_send![cls, new];
                    let _: () = msg_send![&*generator, notificationOccurred: kind];
                }
                Feedback::Selection => {
                    let Some(cls) = class(c"UISelectionFeedbackGenerator") else {
                        return;
                    };
                    let generator: Retained<AnyObject> = msg_send![cls, new];
                    let _: () = msg_send![&*generator, selectionChanged];
                }
            }
        }
    }

    /// The view controller currently on top, to present the share sheet from.
    unsafe fn top_view_controller() -> Option<*mut AnyObject> {
        let app_cls = class(c"UIApplication")?;
        let app: *mut AnyObject = msg_send![app_cls, sharedApplication];
        if app.is_null() {
            return None;
        }
        let mut window: *mut AnyObject = msg_send![app, keyWindow];
        if window.is_null() {
            let windows: *mut AnyObject = msg_send![app, windows];
            if windows.is_null() {
                return None;
            }
            window = msg_send![windows, firstObject];
        }
        if window.is_null() {
            return None;
        }
        let mut top: *mut AnyObject = msg_send![window, rootViewController];
        if top.is_null() {
            return None;
        }
        loop {
            let presented: *mut AnyObject = msg_send![top, presentedViewController];
            if presented.is_null() {
                break;
            }
            top = presented;
        }
        Some(top)
    }

    pub fn share_files(paths: &[String]) {
        unsafe {
            let (Some(url_cls), Some(sheet_cls)) =
                (class(c"NSURL"), class(c"UIActivityViewController"))
            else {
                return;
            };
            let urls: Vec<Retained<AnyObject>> = paths
                .iter()
                .filter_map(|p| {
                    let path = NSString::from_str(p);
                    let url: Option<Retained<AnyObject>> =
                        msg_send![url_cls, fileURLWithPath: &*path];
                    url
                })
                .collect();
            if urls.is_empty() {
                return;
            }
            let items = NSArray::from_retained_slice(&urls);
            let Some(top) = top_view_controller() else {
                return;
            };
            let obj: Allocated<AnyObject> = msg_send![sheet_cls, alloc];
            let sheet: Retained<AnyObject> = msg_send![
                obj,
                initWithActivityItems: &*items,
                applicationActivities: std::ptr::null::<NSArray<AnyObject>>()
            ];
            // iPad shows the sheet as a popover, which needs an anchor.
            let popover: *mut AnyObject = msg_send![&*sheet, popoverPresentationController];
            if !popover.is_null() {
                let view: *mut AnyObject = msg_send![top, view];
                let _: () = msg_send![popover, setSourceView: view];
            }
            let _: () = msg_send![
                top,
                presentViewController: &*sheet,
                animated: true,
                completion: None::<&Block<dyn Fn()>>
            ];
        }
    }
}
