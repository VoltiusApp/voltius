// Take a look at the license at the top of the repository in the LICENSE file.

use crate::FlowBox;
use glib::object::IsA;
use glib::translate::*;
use std::ptr;

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::FlowBox>> Sealed for T {}
}

pub trait FlowBoxExtManual: IsA<FlowBox> + sealed::Sealed + 'static {
    fn unbind_model(&self) {
        unsafe {
            ffi::gtk_flow_box_bind_model(
                self.as_ref().to_glib_none().0,
                ptr::null_mut(),
                None,
                ptr::null_mut(),
                None,
            )
        }
    }
}

impl<O: IsA<FlowBox>> FlowBoxExtManual for O {}
