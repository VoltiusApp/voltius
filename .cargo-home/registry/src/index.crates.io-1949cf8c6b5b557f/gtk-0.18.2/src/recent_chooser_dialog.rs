// Take a look at the license at the top of the repository in the LICENSE file.

use crate::RecentChooserDialog;
use crate::RecentManager;
use crate::Widget;
use crate::Window;
use glib::object::{Cast, IsA};
use glib::translate::*;
use std::ptr;

impl RecentChooserDialog {
    #[doc(alias = "gtk_recent_chooser_dialog_new")]
    pub fn new<T: IsA<Window>>(title: Option<&str>, parent: Option<&T>) -> RecentChooserDialog {
        assert_initialized_main_thread!();
        unsafe {
            Widget::from_glib_none(ffi::gtk_recent_chooser_dialog_new(
                title.to_glib_none().0,
                parent.map(|p| p.as_ref()).to_glib_none().0,
                ptr::null_mut(),
            ))
            .unsafe_cast()
        }
    }

    #[doc(alias = "gtk_recent_chooser_dialog_new_for_manager")]
    #[doc(alias = "new_for_manager")]
    pub fn for_manager<T: IsA<Window>>(
        title: Option<&str>,
        parent: Option<&T>,
        manager: &RecentManager,
    ) -> RecentChooserDialog {
        assert_initialized_main_thread!();
        unsafe {
            Widget::from_glib_none(ffi::gtk_recent_chooser_dialog_new_for_manager(
                title.to_glib_none().0,
                parent.map(|p| p.as_ref()).to_glib_none().0,
                manager.to_glib_none().0,
                ptr::null_mut(),
            ))
            .unsafe_cast()
        }
    }
}
