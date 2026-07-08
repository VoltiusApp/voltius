// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

#[repr(packed)]
pub struct GRange(pub i32, pub i32);

#[doc(alias = "gdk_pango_layout_line_get_clip_region")]
pub fn pango_layout_line_get_clip_region(
    line: &pango::LayoutLine,
    x_origin: i32,
    y_origin: i32,
    index_ranges: &[GRange],
) -> Option<cairo::Region> {
    assert_initialized_main_thread!();

    let ptr: *const i32 = index_ranges.as_ptr() as _;
    unsafe {
        from_glib_full(ffi::gdk_pango_layout_line_get_clip_region(
            line.to_glib_none().0,
            x_origin,
            y_origin,
            mut_override(ptr),
            index_ranges.len() as i32,
        ))
    }
}

#[doc(alias = "gdk_pango_layout_get_clip_region")]
pub fn pango_layout_get_clip_region(
    layout: &pango::Layout,
    x_origin: i32,
    y_origin: i32,
    index_ranges: &[GRange],
) -> Option<cairo::Region> {
    assert_initialized_main_thread!();

    let ptr: *const i32 = index_ranges.as_ptr() as _;
    unsafe {
        from_glib_full(ffi::gdk_pango_layout_get_clip_region(
            layout.to_glib_none().0,
            x_origin,
            y_origin,
            ptr,
            index_ranges.len() as i32,
        ))
    }
}

#[doc(alias = "gdk_setting_get")]
pub fn setting_get(name: &str) -> Option<glib::Value> {
    assert_initialized_main_thread!();
    unsafe {
        let mut value = glib::Value::uninitialized();
        let done: bool = from_glib(ffi::gdk_setting_get(
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

#[doc(alias = "gdk_property_change")]
pub fn property_change(
    window: &super::Window,
    property: &super::Atom,
    type_: &super::Atom,
    format: i32,
    mode: super::PropMode,
    data: super::ChangeData,
) {
    skip_assert_initialized!();
    let nelements = data.len();
    unsafe {
        ffi::gdk_property_change(
            window.to_glib_none().0,
            property.to_glib_none().0,
            type_.to_glib_none().0,
            format,
            mode.into_glib(),
            data.to_glib(),
            nelements as i32,
        );
    }
}
