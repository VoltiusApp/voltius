// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventPadButton(crate::Event);

event_wrapper!(EventPadButton, GdkEventPadButton);
event_subtype!(
    EventPadButton,
    ffi::GDK_PAD_BUTTON_PRESS | ffi::GDK_PAD_BUTTON_RELEASE
);

impl EventPadButton {
    #[doc(alias = "get_time")]
    pub fn time(&self) -> u32 {
        self.as_ref().time
    }

    #[doc(alias = "get_group")]
    pub fn group(&self) -> u32 {
        self.as_ref().group
    }

    #[doc(alias = "get_button")]
    pub fn button(&self) -> u32 {
        self.as_ref().button
    }

    #[doc(alias = "get_mode")]
    pub fn mode(&self) -> u32 {
        self.as_ref().mode
    }
}
