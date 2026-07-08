// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventProperty(crate::Event);

event_wrapper!(EventProperty, GdkEventProperty);
event_subtype!(EventProperty, ffi::GDK_PROPERTY_NOTIFY);

impl EventProperty {
    #[doc(alias = "get_atom")]
    pub fn atom(&self) -> crate::Atom {
        unsafe { from_glib_none(self.as_ref().atom) }
    }

    #[doc(alias = "get_time")]
    pub fn time(&self) -> u32 {
        self.as_ref().time
    }

    #[doc(alias = "get_state")]
    pub fn state(&self) -> crate::PropertyState {
        unsafe { from_glib(self.as_ref().state) }
    }
}
