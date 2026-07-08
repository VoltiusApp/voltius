// Take a look at the license at the top of the repository in the LICENSE file.

use crate::CellRendererPixbuf;
use crate::IconSize;
use glib::object::{IsA, ObjectExt};
use glib::translate::*;

pub trait CellRendererPixbufExtManual:
    IsA<CellRendererPixbuf> + IsA<glib::object::Object> + 'static
{
    #[doc(alias = "get_property_stock_size")]
    fn stock_size(&self) -> IconSize {
        unsafe { from_glib(self.property::<u32>("stock-size") as i32) }
    }

    fn set_stock_size(&self, stock_size: IconSize) {
        self.set_property("stock-size", stock_size.into_glib() as u32);
    }
}

impl<O: IsA<CellRendererPixbuf> + IsA<glib::object::Object>> CellRendererPixbufExtManual for O {}
