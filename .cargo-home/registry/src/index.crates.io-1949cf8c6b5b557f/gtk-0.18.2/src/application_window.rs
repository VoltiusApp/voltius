// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Application;
use crate::ApplicationWindow;
use crate::Widget;
use glib::object::Cast;
use glib::object::IsA;
use glib::translate::*;

impl ApplicationWindow {
    #[doc(alias = "gtk_application_window_new")]
    pub fn new<P: IsA<Application>>(application: &P) -> ApplicationWindow {
        skip_assert_initialized!();
        unsafe {
            Widget::from_glib_none(ffi::gtk_application_window_new(
                application.as_ref().to_glib_none().0,
            ))
            .unsafe_cast()
        }
    }
}
