// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Table;
use glib::object::IsA;
use glib::translate::*;

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::Table>> Sealed for T {}
}

pub trait TableExtManual: IsA<Table> + sealed::Sealed + 'static {
    #[doc(alias = "atk_table_get_selected_columns")]
    #[doc(alias = "get_selected_columns")]
    fn selected_columns(&self) -> Vec<i32> {
        unsafe {
            let mut selected = ::std::ptr::null_mut();
            let nb =
                ffi::atk_table_get_selected_columns(self.as_ref().to_glib_none().0, &mut selected);
            if nb <= 0 {
                Vec::new()
            } else {
                Vec::from_raw_parts(selected, nb as usize, nb as usize)
            }
        }
    }

    #[doc(alias = "atk_table_get_selected_rows")]
    #[doc(alias = "get_selected_rows")]
    fn selected_rows(&self) -> Vec<i32> {
        unsafe {
            let mut selected = ::std::ptr::null_mut();
            let nb =
                ffi::atk_table_get_selected_rows(self.as_ref().to_glib_none().0, &mut selected);
            if nb <= 0 {
                Vec::new()
            } else {
                Vec::from_raw_parts(selected, nb as usize, nb as usize)
            }
        }
    }
}

impl<O: IsA<Table>> TableExtManual for O {}
