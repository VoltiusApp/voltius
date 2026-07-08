// Take a look at the license at the top of the repository in the LICENSE file.

use crate::SelectionData;
use glib::translate::*;
use std::mem;

impl SelectionData {
    #[doc(alias = "gtk_selection_data_get_data_with_length")]
    #[doc(alias = "get_data")]
    pub fn data(&self) -> Vec<u8> {
        unsafe {
            let mut length = mem::MaybeUninit::uninit();
            FromGlibContainer::from_glib_none_num(
                ffi::gtk_selection_data_get_data_with_length(
                    self.to_glib_none().0,
                    length.as_mut_ptr(),
                ),
                length.assume_init() as usize,
            )
        }
    }
}
