// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventProximity(crate::Event);

event_wrapper!(EventProximity, GdkEventProximity);
event_subtype!(
    EventProximity,
    ffi::GDK_PROXIMITY_IN | ffi::GDK_PROXIMITY_OUT
);

impl EventProximity {
    #[doc(alias = "get_time")]
    pub fn time(&self) -> u32 {
        self.as_ref().time
    }

    #[doc(alias = "get_device")]
    pub fn device(&self) -> Option<crate::Device> {
        unsafe { from_glib_none(self.as_ref().device) }
    }
}
