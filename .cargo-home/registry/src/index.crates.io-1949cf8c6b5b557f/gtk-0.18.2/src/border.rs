// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;
use std::fmt;
use std::ops;

glib::wrapper! {
    #[doc(alias = "GtkBorder")]
    pub struct Border(BoxedInline<ffi::GtkBorder>);

    match fn {
        copy => |ptr| ffi::gtk_border_copy(mut_override(ptr)),
        free => |ptr| ffi::gtk_border_free(ptr),
        type_ => || ffi::gtk_border_get_type(),
    }
}

impl ops::Deref for Border {
    type Target = ffi::GtkBorder;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl ops::DerefMut for Border {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl Border {
    #[doc(alias = "gtk_border_new")]
    pub fn new() -> Self {
        assert_initialized_main_thread!();
        unsafe { from_glib_full(ffi::gtk_border_new()) }
    }
}

impl Default for Border {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for Border {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> Result<(), fmt::Error> {
        fmt.debug_struct("Border")
            .field("left", &self.left)
            .field("right", &self.right)
            .field("top", &self.top)
            .field("bottom", &self.bottom)
            .finish()
    }
}

impl PartialEq for Border {
    fn eq(&self, other: &Self) -> bool {
        self.left == other.left
            && self.right == other.right
            && self.top == other.top
            && self.bottom == other.bottom
    }
}

impl Eq for Border {}
