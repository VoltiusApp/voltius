// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventFocus(crate::Event);

event_wrapper!(EventFocus, GdkEventFocus);
event_subtype!(EventFocus, ffi::GDK_FOCUS_CHANGE);

impl EventFocus {
    #[doc(alias = "get_in")]
    pub fn is_in(&self) -> bool {
        unsafe { from_glib(self.as_ref().in_ as _) }
    }
}
