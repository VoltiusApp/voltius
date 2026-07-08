// Take a look at the license at the top of the repository in the LICENSE file.

use crate::FileChooserAction;
use crate::FileChooserDialog;
use crate::ResponseType;
use crate::Widget;
use crate::Window;
use glib::object::{Cast, IsA};
use glib::translate::*;
use libc::c_char;
use std::ptr;

impl FileChooserDialog {
    // TODO: Keep the other constructor with buttons support as the only constructor (this one was
    //       left for compatibility) and rename it to `new` for consistency.
    #[doc(alias = "gtk_file_chooser_dialog_new")]
    pub fn new<T: IsA<Window>>(
        title: Option<&str>,
        parent: Option<&T>,
        action: FileChooserAction,
    ) -> FileChooserDialog {
        assert_initialized_main_thread!();
        unsafe {
            Widget::from_glib_none(ffi::gtk_file_chooser_dialog_new(
                title.to_glib_none().0,
                parent.map(|p| p.as_ref()).to_glib_none().0,
                action.into_glib(),
                ptr::null::<c_char>(),
            ))
            .unsafe_cast()
        }
    }

    #[doc(alias = "gtk_file_chooser_dialog_new")]
    pub fn with_buttons<T: IsA<Window>>(
        title: Option<&str>,
        parent: Option<&T>,
        action: FileChooserAction,
        buttons: &[(&str, ResponseType)],
    ) -> FileChooserDialog {
        assert_initialized_main_thread!();
        unsafe {
            Widget::from_glib_none(match buttons.len() {
                0 => {
                    ffi::gtk_file_chooser_dialog_new(
                        title.to_glib_none().0,
                        parent.map(|p| p.as_ref()).to_glib_none().0,
                        action.into_glib(),
                        ptr::null::<c_char>()
                    )
                },
                1 => {
                    ffi::gtk_file_chooser_dialog_new(
                        title.to_glib_none().0,
                        parent.map(|p| p.as_ref()).to_glib_none().0,
                        action.into_glib(),
                        buttons[0].0.to_glib_none().0,
                        buttons[0].1.into_glib(),
                        ptr::null::<c_char>(),
                    )
                },
                2 => {
                    ffi::gtk_file_chooser_dialog_new(
                        title.to_glib_none().0,
                        parent.map(|p| p.as_ref()).to_glib_none().0,
                        action.into_glib(),
                        buttons[0].0.to_glib_none().0,
                        buttons[0].1.into_glib(),
                        (buttons[1].0.to_glib_none() as Stash<*const c_char, str>).0,
                        buttons[1].1.into_glib(),
                        ptr::null::<c_char>(),
                    )
                },
                3 => {
                    ffi::gtk_file_chooser_dialog_new(
                        title.to_glib_none().0,
                        parent.map(|p| p.as_ref()).to_glib_none().0,
                        action.into_glib(),
                        buttons[0].0.to_glib_none().0,
                        buttons[0].1.into_glib(),
                        (buttons[1].0.to_glib_none() as Stash<*const c_char, str>).0,
                        buttons[1].1.into_glib(),
                        (buttons[2].0.to_glib_none() as Stash<*const c_char, str>).0,
                        buttons[2].1.into_glib(),
                        ptr::null::<c_char>(),
                    )
                },
                _ => {
                    // TODO: Support arbitrary number of buttons once variadic functions are supported.
                    //       See: https://github.com/rust-lang/rust/issues/44930
                    panic!("`FileChooserDialog::with_buttons` does not support 4+ buttons, received {}", buttons.len())
                }
            }).unsafe_cast()
        }
    }
}
