// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventVisibility(crate::Event);

event_wrapper!(EventVisibility, GdkEventVisibility);
event_subtype!(EventVisibility, ffi::GDK_VISIBILITY_NOTIFY);

impl EventVisibility {
    #[doc(alias = "get_state")]
    pub fn state(&self) -> crate::VisibilityState {
        unsafe { from_glib(self.as_ref().state) }
    }
}
