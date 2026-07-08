// Take a look at the license at the top of the repository in the LICENSE file.

use crate::IMContextSimple;
use glib::translate::*;
use glib::IsA;
use std::path::Path;

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::IMContextSimple>> Sealed for T {}
}

pub trait IMContextSimpleExtManual: IsA<IMContextSimple> + sealed::Sealed + 'static {
    #[doc(alias = "gtk_im_context_simple_add_compose_file")]
    fn add_compose_file<P: AsRef<Path>>(&self, compose_file: P) {
        unsafe {
            let compose_file = compose_file.as_ref();
            ffi::gtk_im_context_simple_add_compose_file(
                self.as_ref().to_glib_none().0,
                compose_file.to_glib_none().0,
            );
        }
    }

    //#[doc(alias="gtk_im_context_simple_add_table")]
    //fn add_table(&self, data: &[u16], max_seq_len: u32, n_seqs: u32);
}

impl<O: IsA<IMContextSimple>> IMContextSimpleExtManual for O {}
