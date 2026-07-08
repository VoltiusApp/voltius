// Take a look at the license at the top of the repository in the LICENSE file.

use crate::atom::Atom;
use crate::Device;
use crate::DragAction;
use crate::DragContext;
use crate::DragProtocol;
use crate::Screen;
use crate::Window;
use glib::object::IsA;
use glib::translate::*;
use std::ptr;

impl DragContext {
    #[doc(alias = "gdk_drag_get_selection")]
    pub fn drag_get_selection(&self) -> Atom {
        unsafe { from_glib_none(ffi::gdk_drag_get_selection(self.to_glib_none().0) as *mut _) }
    }

    #[doc(alias = "gdk_drag_abort")]
    pub fn drag_abort(&self, time_: u32) {
        unsafe { ffi::gdk_drag_abort(self.to_glib_none().0, time_) }
    }

    #[doc(alias = "gdk_drop_reply")]
    pub fn drop_reply(&self, accepted: bool, time_: u32) {
        unsafe { ffi::gdk_drop_reply(self.to_glib_none().0, accepted.into_glib(), time_) }
    }

    #[doc(alias = "gdk_drag_drop")]
    pub fn drop(&self, time_: u32) {
        unsafe { ffi::gdk_drag_drop(self.to_glib_none().0, time_) }
    }

    #[doc(alias = "gdk_drag_find_window_for_screen")]
    pub fn drag_find_window_for_screen(
        &self,
        drag_window: &Window,
        screen: &Screen,
        x_root: i32,
        y_root: i32,
    ) -> (Option<Window>, DragProtocol) {
        unsafe {
            let mut dest_window = ptr::null_mut();
            let mut protocol = ffi::GDK_DRAG_PROTO_NONE;
            ffi::gdk_drag_find_window_for_screen(
                self.to_glib_none().0,
                drag_window.to_glib_none().0,
                screen.to_glib_none().0,
                x_root,
                y_root,
                &mut dest_window,
                &mut protocol,
            );
            (from_glib_full(dest_window), from_glib(protocol))
        }
    }

    #[allow(clippy::too_many_arguments)]
    #[doc(alias = "gdk_drag_motion")]
    pub fn drag_motion(
        &self,
        dest_window: &Window,
        protocol: DragProtocol,
        x_root: i32,
        y_root: i32,
        suggested_action: DragAction,
        possible_actions: DragAction,
        time_: u32,
    ) -> bool {
        unsafe {
            from_glib(ffi::gdk_drag_motion(
                self.to_glib_none().0,
                dest_window.to_glib_none().0,
                protocol.into_glib(),
                x_root,
                y_root,
                suggested_action.into_glib(),
                possible_actions.into_glib(),
                time_,
            ))
        }
    }

    #[doc(alias = "gdk_drop_finish")]
    pub fn drop_finish(&self, success: bool, time_: u32) {
        unsafe { ffi::gdk_drop_finish(self.to_glib_none().0, success.into_glib(), time_) }
    }

    #[doc(alias = "gdk_drag_status")]
    pub fn drag_status(&self, action: DragAction, time_: u32) {
        unsafe { ffi::gdk_drag_status(self.to_glib_none().0, action.into_glib(), time_) }
    }

    #[doc(alias = "gdk_drag_drop_succeeded")]
    pub fn drag_drop_succeeded(&self) -> bool {
        unsafe { from_glib(ffi::gdk_drag_drop_succeeded(self.to_glib_none().0)) }
    }

    #[doc(alias = "gdk_drag_begin")]
    pub fn drag_begin(window: &Window, targets: &[Atom]) -> Option<DragContext> {
        skip_assert_initialized!();
        unsafe {
            from_glib_full(ffi::gdk_drag_begin(
                window.to_glib_none().0,
                targets.to_glib_none().0,
            ))
        }
    }

    #[doc(alias = "gdk_drag_begin_for_device")]
    pub fn drag_begin_for_device<P: IsA<Device>>(
        window: &Window,
        device: &P,
        targets: &[Atom],
    ) -> Option<DragContext> {
        skip_assert_initialized!();
        unsafe {
            from_glib_full(ffi::gdk_drag_begin_for_device(
                window.to_glib_none().0,
                device.as_ref().to_glib_none().0,
                targets.to_glib_none().0,
            ))
        }
    }

    #[doc(alias = "gdk_drag_begin_from_point")]
    pub fn drag_begin_from_point<P: IsA<Device>>(
        window: &Window,
        device: &P,
        targets: &[Atom],
        x_root: i32,
        y_root: i32,
    ) -> Option<DragContext> {
        skip_assert_initialized!();
        unsafe {
            from_glib_full(ffi::gdk_drag_begin_from_point(
                window.to_glib_none().0,
                device.as_ref().to_glib_none().0,
                targets.to_glib_none().0,
                x_root,
                y_root,
            ))
        }
    }

    #[doc(alias = "gdk_drag_drop_done")]
    pub fn drag_drop_done(&self, success: bool) {
        skip_assert_initialized!();
        unsafe {
            ffi::gdk_drag_drop_done(self.to_glib_none().0, success.into_glib());
        }
    }
}
