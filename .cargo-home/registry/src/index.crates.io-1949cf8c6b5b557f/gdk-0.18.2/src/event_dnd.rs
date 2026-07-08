// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EventDND(crate::Event);

event_wrapper!(EventDND, GdkEventDND);
event_subtype!(
    EventDND,
    ffi::GDK_DRAG_ENTER
        | ffi::GDK_DRAG_LEAVE
        | ffi::GDK_DRAG_MOTION
        | ffi::GDK_DRAG_STATUS
        | ffi::GDK_DROP_START
        | ffi::GDK_DROP_FINISHED
);

impl EventDND {
    #[doc(alias = "get_context")]
    pub fn context(&self) -> Option<crate::DragContext> {
        unsafe { from_glib_none(self.as_ref().context) }
    }

    #[doc(alias = "get_time")]
    pub fn time(&self) -> u32 {
        self.as_ref().time
    }

    #[doc(alias = "get_root")]
    pub fn root(&self) -> (i16, i16) {
        let x_root = self.as_ref().x_root;
        let y_root = self.as_ref().y_root;
        (x_root, y_root)
    }
}
