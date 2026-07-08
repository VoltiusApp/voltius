// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventTouchpadSwipe(crate::Event);

event_wrapper!(EventTouchpadSwipe, GdkEventTouchpadSwipe);
event_subtype!(EventTouchpadSwipe, ffi::GDK_TOUCHPAD_SWIPE);

impl EventTouchpadSwipe {
    pub fn is_phase(&self) -> bool {
        unsafe { from_glib(self.as_ref().phase as _) }
    }

    #[doc(alias = "get_n_fingers")]
    pub fn n_fingers(&self) -> i8 {
        self.as_ref().n_fingers
    }

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

    #[doc(alias = "get_delta")]
    pub fn delta(&self) -> (f64, f64) {
        let dx = self.as_ref().dx;
        let dy = self.as_ref().dy;
        (dx, dy)
    }

    #[doc(alias = "get_root")]
    pub fn root(&self) -> (f64, f64) {
        let x_root = self.as_ref().x_root;
        let y_root = self.as_ref().y_root;
        (x_root, y_root)
    }

    #[doc(alias = "get_state")]
    pub fn state(&self) -> crate::ModifierType {
        unsafe { from_glib(self.as_ref().state) }
    }
}
