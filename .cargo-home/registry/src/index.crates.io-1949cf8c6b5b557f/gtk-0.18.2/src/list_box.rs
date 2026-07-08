// Take a look at the license at the top of the repository in the LICENSE file.

use crate::ListBox;
use glib::object::IsA;
use glib::translate::*;
use std::ptr;

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::ListBox>> Sealed for T {}
}

pub trait ListBoxExtManual: IsA<ListBox> + sealed::Sealed + 'static {
    fn unbind_model(&self) {
        unsafe {
            ffi::gtk_list_box_bind_model(
                self.as_ref().to_glib_none().0,
                ptr::null_mut(),
                None,
                ptr::null_mut(),
                None,
            )
        }
    }
}

impl<O: IsA<ListBox>> ListBoxExtManual for O {}
