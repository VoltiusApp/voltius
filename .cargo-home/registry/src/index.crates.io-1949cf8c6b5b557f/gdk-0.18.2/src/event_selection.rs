// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventSelection(crate::Event);

event_wrapper!(EventSelection, GdkEventSelection);
event_subtype!(
    EventSelection,
    ffi::GDK_SELECTION_CLEAR | ffi::GDK_SELECTION_NOTIFY | ffi::GDK_SELECTION_REQUEST
);

impl EventSelection {
    #[doc(alias = "get_selection")]
    pub fn selection(&self) -> crate::Atom {
        unsafe { from_glib_none(self.as_ref().selection as *mut _) }
    }

    #[doc(alias = "get_target")]
    pub fn target(&self) -> crate::Atom {
        unsafe { from_glib_none(self.as_ref().target as *mut _) }
    }

    #[doc(alias = "get_property")]
    pub fn property(&self) -> crate::Atom {
        unsafe { from_glib_none(self.as_ref().property as *mut _) }
    }

    #[doc(alias = "get_time")]
    pub fn time(&self) -> u32 {
        self.as_ref().time
    }

    #[doc(alias = "get_requestor")]
    pub fn requestor(&self) -> Option<crate::Window> {
        unsafe { from_glib_none(self.as_ref().requestor) }
    }
}
