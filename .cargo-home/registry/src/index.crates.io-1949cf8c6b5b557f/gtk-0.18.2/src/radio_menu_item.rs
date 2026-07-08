// Take a look at the license at the top of the repository in the LICENSE file.

use crate::RadioMenuItem;
use crate::Widget;
use glib::object::Cast;
use glib::translate::*;
use std::ptr;

impl RadioMenuItem {
    #[doc(alias = "gtk_radio_menu_item_new")]
    pub fn new() -> Self {
        assert_initialized_main_thread!();
        unsafe {
            Widget::from_glib_none(ffi::gtk_radio_menu_item_new(ptr::null_mut())).unsafe_cast()
        }
    }

    #[doc(alias = "gtk_radio_menu_item_new_with_label")]
    pub fn with_label(label: &str) -> Self {
        assert_initialized_main_thread!();
        unsafe {
            Widget::from_glib_none(ffi::gtk_radio_menu_item_new_with_label(
                ptr::null_mut(),
                label.to_glib_none().0,
            ))
            .unsafe_cast()
        }
    }

    #[doc(alias = "gtk_radio_menu_item_new_with_mnemonic")]
    pub fn with_mnemonic(label: &str) -> Self {
        assert_initialized_main_thread!();
        unsafe {
            Widget::from_glib_none(ffi::gtk_radio_menu_item_new_with_mnemonic(
                ptr::null_mut(),
                label.to_glib_none().0,
            ))
            .unsafe_cast()
        }
    }
}

impl Default for RadioMenuItem {
    fn default() -> Self {
        Self::new()
    }
}
