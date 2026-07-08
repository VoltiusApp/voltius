// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventTouch(crate::Event);

event_wrapper!(EventTouch, GdkEventTouch);
event_subtype!(
    EventTouch,
    ffi::GDK_TOUCH_BEGIN | ffi::GDK_TOUCH_UPDATE | ffi::GDK_TOUCH_END | ffi::GDK_TOUCH_CANCEL
);

impl EventTouch {
    #[doc(alias = "get_time")]
    pub fn time(&self) -> u32 {
        self.as_ref().time
    }

    #[doc(alias = "get_position")]
    pub fn position(&self) -> (f64, f64) {
        let x = self.as_ref().x;
        let y = self.as_ref().y;
        (x, y)
    }

    #[doc(alias = "get_state")]
    pub fn state(&self) -> crate::ModifierType {
        unsafe { from_glib(self.as_ref().state) }
    }

    pub fn is_emulating_pointer(&self) -> bool {
        unsafe { from_glib(self.as_ref().emulating_pointer) }
    }

    #[doc(alias = "get_device")]
    pub fn device(&self) -> Option<crate::Device> {
        unsafe { from_glib_none(self.as_ref().device) }
    }

    #[doc(alias = "get_axes")]
    pub fn axes(&self) -> Option<(f64, f64)> {
        let axes = self.as_ref().axes;

        if axes.is_null() {
            None
        } else {
            unsafe { Some((*axes, *axes.offset(1))) }
        }
    }

    #[doc(alias = "get_root")]
    pub fn root(&self) -> (f64, f64) {
        let x_root = self.as_ref().x_root;
        let y_root = self.as_ref().y_root;
        (x_root, y_root)
    }

    #[doc(alias = "get_event_sequence")]
    pub fn event_sequence(&self) -> Option<crate::EventSequence> {
        unsafe { from_glib_none(self.as_ref().sequence) }
    }
}
