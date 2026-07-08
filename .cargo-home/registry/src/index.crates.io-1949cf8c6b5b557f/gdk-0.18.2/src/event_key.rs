// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventKey(crate::Event);

event_wrapper!(EventKey, GdkEventKey);
event_subtype!(EventKey, ffi::GDK_KEY_PRESS | ffi::GDK_KEY_RELEASE);

impl EventKey {
    #[doc(alias = "get_time")]
    pub fn time(&self) -> u32 {
        self.as_ref().time
    }

    #[doc(alias = "get_state")]
    pub fn state(&self) -> crate::ModifierType {
        unsafe { from_glib(self.as_ref().state) }
    }

    #[doc(alias = "get_keyval")]
    pub fn keyval(&self) -> crate::keys::Key {
        unsafe { from_glib(self.as_ref().keyval) }
    }

    #[doc(alias = "get_length")]
    pub fn length(&self) -> u32 {
        let length = self.as_ref().length;
        assert!(length >= 0, "Unexpected negative value");
        length as u32
    }

    #[doc(alias = "get_hardware_keycode")]
    pub fn hardware_keycode(&self) -> u16 {
        self.as_ref().hardware_keycode
    }

    #[doc(alias = "get_group")]
    pub fn group(&self) -> u8 {
        self.as_ref().group
    }

    #[doc(alias = "get_is_modifier")]
    pub fn is_modifier(&self) -> bool {
        self.as_ref().is_modifier & 1 != 0
    }
}
