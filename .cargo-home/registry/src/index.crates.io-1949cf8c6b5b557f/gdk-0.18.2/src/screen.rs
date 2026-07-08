// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Screen;
use glib::translate::*;

impl Screen {
    #[doc(alias = "gdk_screen_get_font_options")]
    #[doc(alias = "get_font_options")]
    pub fn font_options(&self) -> Option<cairo::FontOptions> {
        unsafe {
            from_glib_none(mut_override(ffi::gdk_screen_get_font_options(
                self.to_glib_none().0,
            )))
        }
    }

    #[doc(alias = "gdk_screen_get_setting")]
    #[doc(alias = "get_setting")]
    pub fn setting(&self, name: &str) -> Option<glib::Value> {
        unsafe {
            let mut value = glib::Value::uninitialized();
            let done: bool = from_glib(ffi::gdk_screen_get_setting(
                self.to_glib_none().0,
                name.to_glib_none().0,
                value.to_glib_none_mut().0,
            ));

            if done {
                Some(value)
            } else {
                None
            }
        }
    }
}
