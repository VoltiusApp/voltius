// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Visual;
use std::ptr;
use std::slice;

impl Visual {
    #[doc(alias = "gdk_query_depths")]
    pub fn query_depths() -> Vec<i32> {
        assert_initialized_main_thread!();
        let mut ptr = ptr::null_mut();
        let mut count = 0;

        unsafe {
            ffi::gdk_query_depths(&mut ptr, &mut count);
            if ptr.is_null() || count == 0 {
                vec![]
            } else {
                Vec::from(slice::from_raw_parts(ptr as *const i32, count as usize))
            }
        }
    }
}
