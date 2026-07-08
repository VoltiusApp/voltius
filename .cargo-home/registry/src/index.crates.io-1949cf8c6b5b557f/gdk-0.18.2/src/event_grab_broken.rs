// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventGrabBroken(crate::Event);

event_wrapper!(EventGrabBroken, GdkEventGrabBroken);
event_subtype!(EventGrabBroken, ffi::GDK_GRAB_BROKEN);

impl EventGrabBroken {
    pub fn is_keyboard(&self) -> bool {
        unsafe { from_glib(self.as_ref().keyboard) }
    }

    pub fn is_implicit(&self) -> bool {
        unsafe { from_glib(self.as_ref().implicit) }
    }

    #[doc(alias = "get_grab_window")]
    pub fn grab_window(&self) -> Option<crate::Window> {
        unsafe { from_glib_none(self.as_ref().grab_window) }
    }
}
