// Take a look at the license at the top of the repository in the LICENSE file.

//! Traits intended for blanket imports.

pub use crate::auto::traits::*;
pub use crate::cairo_interaction::{GdkContextExt, GdkPixbufExt, GdkSurfaceExt};
pub use crate::device::DeviceExtManual;
pub use crate::display::DisplayExtManual;
pub use crate::window::WindowExtManual;

#[doc(hidden)]
pub use gdk_pixbuf::prelude::*;
#[doc(hidden)]
pub use gio::prelude::*;
#[doc(hidden)]
pub use glib::prelude::*;
#[doc(hidden)]
pub use pango::prelude::*;
