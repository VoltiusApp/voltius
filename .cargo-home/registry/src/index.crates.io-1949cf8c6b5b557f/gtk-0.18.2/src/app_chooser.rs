// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Widget;
use gio::AppInfo;
use glib::object::IsA;
use glib::translate::*;

glib::wrapper! {
    pub struct AppChooser(Interface<ffi::GtkAppChooser>) @requires Widget;

    match fn {
        type_ => || ffi::gtk_app_chooser_get_type(),
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::AppChooser>> Sealed for T {}
}

pub trait AppChooserExt: IsA<AppChooser> + sealed::Sealed + 'static {
    #[doc(alias = "gtk_app_chooser_get_app_info")]
    #[doc(alias = "get_app_info")]
    fn app_info(&self) -> Option<AppInfo> {
        unsafe {
            from_glib_full(ffi::gtk_app_chooser_get_app_info(
                self.as_ref().to_glib_none().0,
            ))
        }
    }

    #[doc(alias = "gtk_app_chooser_get_content_type")]
    #[doc(alias = "get_content_type")]
    fn content_type(&self) -> Option<String> {
        unsafe {
            from_glib_full(ffi::gtk_app_chooser_get_content_type(
                self.as_ref().to_glib_none().0,
            ))
        }
    }

    #[doc(alias = "gtk_app_chooser_refresh")]
    fn refresh(&self) {
        unsafe { ffi::gtk_app_chooser_refresh(self.as_ref().to_glib_none().0) }
    }
}

impl<O: IsA<AppChooser>> AppChooserExt for O {}
