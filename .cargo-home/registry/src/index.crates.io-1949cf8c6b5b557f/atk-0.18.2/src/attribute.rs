// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;
use glib::GString;
use std::fmt;

#[doc(alias = "AtkAttribute")]
pub struct Attribute {
    pub name: GString,
    pub value: GString,
}

impl fmt::Display for Attribute {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.debug_struct("Attribute")
            .field("name", &self.name)
            .field("value", &self.value)
            .finish()
    }
}

#[doc(hidden)]
impl FromGlib<ffi::AtkAttribute> for Attribute {
    unsafe fn from_glib(value: ffi::AtkAttribute) -> Self {
        skip_assert_initialized!();
        Self {
            name: from_glib_full(value.name),
            value: from_glib_full(value.value),
        }
    }
}

#[doc(hidden)]
impl IntoGlib for Attribute {
    type GlibType = ffi::AtkAttribute;

    fn into_glib(self) -> ffi::AtkAttribute {
        ffi::AtkAttribute {
            name: self.name.to_glib_none().0,
            value: self.value.to_glib_none().0,
        }
    }
}
