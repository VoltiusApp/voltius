// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[cfg(feature = "v1_44")]
use crate::ShapeFlags;
use crate::{Analysis, GlyphString, Item};

#[doc(alias = "pango_reorder_items")]
pub fn reorder_items(logical_items: &glib::List<Item>) -> glib::List<Item> {
    unsafe {
        FromGlibPtrContainer::from_glib_full(ffi::pango_reorder_items(
            logical_items.as_ptr() as *mut _
        ))
    }
}

#[doc(alias = "pango_shape_full")]
pub fn shape_full(
    item_text: &str,
    paragraph_text: Option<&str>,
    analysis: &Analysis,
    glyphs: &mut GlyphString,
) {
    let paragraph_length = match paragraph_text {
        Some(s) => s.len(),
        None => 0,
    } as i32;
    let paragraph_text = paragraph_text.to_glib_none();
    let item_length = item_text.len() as i32;
    unsafe {
        ffi::pango_shape_full(
            item_text.to_glib_none().0,
            item_length,
            paragraph_text.0,
            paragraph_length,
            analysis.to_glib_none().0,
            glyphs.to_glib_none_mut().0,
        );
    }
}

#[cfg(feature = "v1_44")]
#[cfg_attr(docsrs, doc(cfg(feature = "v1_44")))]
#[doc(alias = "pango_shape_with_flags")]
pub fn shape_with_flags(
    item_text: &str,
    paragraph_text: Option<&str>,
    analysis: &Analysis,
    glyphs: &mut GlyphString,
    flags: ShapeFlags,
) {
    let item_length = item_text.len() as i32;
    let paragraph_length = paragraph_text.map(|t| t.len() as i32).unwrap_or_default();
    unsafe {
        ffi::pango_shape_with_flags(
            item_text.to_glib_none().0,
            item_length,
            paragraph_text.to_glib_none().0,
            paragraph_length,
            analysis.to_glib_none().0,
            glyphs.to_glib_none_mut().0,
            flags.into_glib(),
        );
    }
}

#[doc(alias = "pango_extents_to_pixels")]
pub fn extents_to_pixels(
    mut inclusive: Option<&mut crate::Rectangle>,
    mut nearest: Option<&mut crate::Rectangle>,
) {
    unsafe {
        ffi::pango_extents_to_pixels(inclusive.to_glib_none_mut().0, nearest.to_glib_none_mut().0);
    }
}
