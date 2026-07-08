// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventButton(crate::Event);

event_wrapper!(EventButton, GdkEventButton);
event_subtype!(
    EventButton,
    ffi::GDK_BUTTON_PRESS
        | ffi::GDK_DOUBLE_BUTTON_PRESS
        | ffi::GDK_TRIPLE_BUTTON_PRESS
        | ffi::GDK_BUTTON_RELEASE
);

impl EventButton {
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

    #[doc(alias = "get_time")]
    pub fn time(&self) -> u32 {
        self.as_ref().time
    }

    #[doc(alias = "get_button")]
    pub fn button(&self) -> u32 {
        self.as_ref().button
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
}
