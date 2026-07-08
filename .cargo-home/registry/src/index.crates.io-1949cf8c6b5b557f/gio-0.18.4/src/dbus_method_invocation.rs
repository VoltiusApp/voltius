// Take a look at the license at the top of the repository in the LICENSE file.

use glib::{error::ErrorDomain, translate::*};

use crate::DBusMethodInvocation;

impl DBusMethodInvocation {
    #[doc(alias = "g_dbus_method_invocation_return_error_literal")]
    pub fn return_error<T: ErrorDomain>(&self, error: T, message: &str) {
        unsafe {
            ffi::g_dbus_method_invocation_return_error_literal(
                self.to_glib_full(),
                T::domain().into_glib(),
                error.code(),
                message.to_glib_none().0,
            );
        }
    }

    #[doc(alias = "g_dbus_method_invocation_return_gerror")]
    pub fn return_gerror(&self, error: glib::Error) {
        unsafe {
            ffi::g_dbus_method_invocation_return_gerror(
                self.to_glib_full(),
                error.to_glib_none().0,
            );
        }
    }
}
