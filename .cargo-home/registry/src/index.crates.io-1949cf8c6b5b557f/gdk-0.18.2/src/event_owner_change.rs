// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventOwnerChange(crate::Event);

event_wrapper!(EventOwnerChange, GdkEventOwnerChange);
event_subtype!(EventOwnerChange, ffi::GDK_OWNER_CHANGE);

impl EventOwnerChange {
    #[doc(alias = "get_owner")]
    pub fn owner(&self) -> Option<crate::Window> {
        unsafe { from_glib_none(self.as_ref().owner) }
    }

    #[doc(alias = "get_reason")]
    pub fn reason(&self) -> crate::OwnerChange {
        unsafe { from_glib(self.as_ref().reason) }
    }

    #[doc(alias = "get_selection")]
    pub fn selection(&self) -> crate::Atom {
        unsafe { from_glib_none(self.as_ref().selection as *mut _) }
    }

    #[doc(alias = "get_time")]
    pub fn time(&self) -> u32 {
        self.as_ref().time
    }

    #[doc(alias = "get_selection_time")]
    pub fn selection_time(&self) -> u32 {
        self.as_ref().selection_time
    }
}
