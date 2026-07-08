// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventScroll(crate::Event);

event_wrapper!(EventScroll, GdkEventScroll);
event_subtype!(EventScroll, ffi::GDK_SCROLL);

impl EventScroll {
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

    #[doc(alias = "get_device")]
    pub fn device(&self) -> Option<crate::Device> {
        unsafe { from_glib_none(self.as_ref().device) }
    }

    #[doc(alias = "get_direction")]
    pub fn direction(&self) -> crate::ScrollDirection {
        unsafe { from_glib(self.as_ref().direction) }
    }

    #[doc(alias = "get_root")]
    pub fn root(&self) -> (f64, f64) {
        let x_root = self.as_ref().x_root;
        let y_root = self.as_ref().y_root;
        (x_root, y_root)
    }

    #[doc(alias = "get_delta")]
    pub fn delta(&self) -> (f64, f64) {
        let dx = self.as_ref().delta_x;
        let dy = self.as_ref().delta_y;
        (dx, dy)
    }

    #[doc(alias = "get_is_stop")]
    pub fn is_stop(&self) -> bool {
        self.as_ref().is_stop & 1 != 0
    }
}
