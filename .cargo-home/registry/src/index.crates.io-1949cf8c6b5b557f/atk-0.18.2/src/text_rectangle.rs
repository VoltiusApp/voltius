// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;
use std::fmt;

#[derive(Debug)]
#[doc(alias = "AtkTextRectangle")]
pub struct TextRectangle {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl TextRectangle {
    pub fn uninitialized() -> Self {
        Self {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        }
    }

    #[doc(hidden)]
    #[inline]
    #[allow(clippy::wrong_self_convention)]
    pub fn to_glib_none_mut(&mut self) -> (*mut ffi::AtkTextRectangle, i32) {
        (self as *mut TextRectangle as usize as *mut _, 0)
    }
}

impl fmt::Display for TextRectangle {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.debug_struct("TextRectangle")
            .field("x", &self.x)
            .field("y", &self.y)
            .field("width", &self.width)
            .field("height", &self.height)
            .finish()
    }
}

#[doc(hidden)]
impl FromGlib<ffi::AtkTextRectangle> for TextRectangle {
    unsafe fn from_glib(value: ffi::AtkTextRectangle) -> Self {
        skip_assert_initialized!();
        Self {
            x: value.x,
            y: value.y,
            width: value.width,
            height: value.height,
        }
    }
}

#[doc(hidden)]
impl IntoGlib for TextRectangle {
    type GlibType = ffi::AtkTextRectangle;

    fn into_glib(self) -> ffi::AtkTextRectangle {
        ffi::AtkTextRectangle {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }
}
