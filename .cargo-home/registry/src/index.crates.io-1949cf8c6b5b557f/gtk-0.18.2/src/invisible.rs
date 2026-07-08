// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Invisible;
use glib::translate::{from_glib_none, ToGlibPtr};
use glib::IsA;

// For some reasons, it's not generated...
mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::Invisible>> Sealed for T {}
}

pub trait InvisibleExtManual: IsA<Invisible> + sealed::Sealed + 'static {
    #[doc(alias = "gtk_invisible_get_screen")]
    #[doc(alias = "get_screen")]
    fn screen(&self) -> Option<gdk::Screen> {
        unsafe {
            from_glib_none(ffi::gtk_invisible_get_screen(
                self.as_ref().to_glib_none().0,
            ))
        }
    }
}

impl<T: IsA<Invisible>> InvisibleExtManual for T {}
