// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Rectangle;
use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventExpose(crate::Event);

event_wrapper!(EventExpose, GdkEventExpose);
event_subtype!(EventExpose, ffi::GDK_EXPOSE | ffi::GDK_DAMAGE);

impl EventExpose {
    #[doc(alias = "get_region")]
    pub fn region(&self) -> Option<cairo::Region> {
        unsafe { from_glib_none(self.as_ref().region) }
    }

    #[doc(alias = "get_count")]
    pub fn count(&self) -> u32 {
        self.as_ref().count as u32
    }

    #[doc(alias = "get_area")]
    pub fn area(&self) -> Rectangle {
        unsafe { from_glib_none(&self.as_ref().area as *const _) }
    }
}
