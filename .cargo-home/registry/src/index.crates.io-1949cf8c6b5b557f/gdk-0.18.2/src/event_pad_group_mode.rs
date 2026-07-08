// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventPadGroupMode(crate::Event);

event_wrapper!(EventPadGroupMode, GdkEventPadGroupMode);
event_subtype!(EventPadGroupMode, ffi::GDK_PAD_GROUP_MODE);

impl EventPadGroupMode {
    #[doc(alias = "get_time")]
    pub fn time(&self) -> u32 {
        self.as_ref().time
    }

    #[doc(alias = "get_group")]
    pub fn group(&self) -> u32 {
        self.as_ref().group
    }

    #[doc(alias = "get_mode")]
    pub fn mode(&self) -> u32 {
        self.as_ref().mode
    }
}
