// Take a look at the license at the top of the repository in the LICENSE file.

use crate::{Rectangle, Window, RGBA};
use cairo::Surface;
use cairo::{Context, Region};
use gdk_pixbuf::Pixbuf;
use glib::object::IsA;
use glib::translate::*;

pub trait GdkSurfaceExt {
    #[doc(alias = "gdk_cairo_region_create_from_surface")]
    fn create_region(&self) -> Option<Region>;
}

impl GdkSurfaceExt for Surface {
    fn create_region(&self) -> Option<Region> {
        unsafe {
            from_glib_full(ffi::gdk_cairo_region_create_from_surface(
                self.to_glib_none().0,
            ))
        }
    }
}

pub trait GdkPixbufExt {
    #[doc(alias = "gdk_cairo_surface_create_from_pixbuf")]
    fn create_surface<W: IsA<Window>>(&self, scale: i32, for_window: Option<&W>)
        -> Option<Surface>;
}

impl GdkPixbufExt for Pixbuf {
    fn create_surface<W: IsA<Window>>(
        &self,
        scale: i32,
        for_window: Option<&W>,
    ) -> Option<Surface> {
        unsafe {
            from_glib_full(ffi::gdk_cairo_surface_create_from_pixbuf(
                self.to_glib_none().0,
                scale,
                for_window.map(std::convert::AsRef::as_ref).to_glib_none().0,
            ))
        }
    }
}

pub trait GdkContextExt {
    fn create_from_window<W: IsA<Window>>(window: &W) -> Context;

    #[allow(clippy::too_many_arguments)]
    unsafe fn draw_from_gl<W: IsA<Window>>(
        &self,
        window: &W,
        source: i32,
        source_type: i32,
        buffer_scale: i32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    );

    #[doc(alias = "get_clip_rectangle")]
    #[doc(alias = "gdk_cairo_get_clip_rectangle")]
    fn clip_rectangle(&self) -> Option<Rectangle>;

    #[doc(alias = "gdk_cairo_set_source_rgba")]
    fn set_source_rgba(&self, rgba: &RGBA);

    #[doc(alias = "gdk_cairo_set_source_pixbuf")]
    fn set_source_pixbuf(&self, pixbuf: &Pixbuf, x: f64, y: f64);

    #[doc(alias = "gdk_cairo_set_source_window")]
    fn set_source_window<W: IsA<Window>>(&self, window: &W, x: f64, y: f64);

    #[doc(alias = "gdk_cairo_rectangle")]
    fn rectangle(&self, rectangle: &Rectangle);

    fn add_region(&self, region: &Region);
}

impl GdkContextExt for Context {
    fn create_from_window<W: IsA<Window>>(window: &W) -> Context {
        skip_assert_initialized!();
        unsafe { from_glib_full(ffi::gdk_cairo_create(window.as_ref().to_glib_none().0)) }
    }

    unsafe fn draw_from_gl<W: IsA<Window>>(
        &self,
        window: &W,
        source: i32,
        source_type: i32,
        buffer_scale: i32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) {
        skip_assert_initialized!();
        ffi::gdk_cairo_draw_from_gl(
            mut_override(self.to_glib_none().0),
            window.as_ref().to_glib_none().0,
            source,
            source_type,
            buffer_scale,
            x,
            y,
            width,
            height,
        );
    }

    fn clip_rectangle(&self) -> Option<Rectangle> {
        unsafe {
            let mut rectangle = Rectangle::uninitialized();
            if from_glib(ffi::gdk_cairo_get_clip_rectangle(
                self.to_glib_none().0,
                rectangle.to_glib_none_mut().0,
            )) {
                Some(rectangle)
            } else {
                None
            }
        }
    }

    fn set_source_rgba(&self, rgba: &RGBA) {
        unsafe {
            ffi::gdk_cairo_set_source_rgba(self.to_glib_none().0, rgba.to_glib_none().0);
        }
    }

    fn set_source_pixbuf(&self, pixbuf: &Pixbuf, x: f64, y: f64) {
        unsafe {
            ffi::gdk_cairo_set_source_pixbuf(self.to_glib_none().0, pixbuf.to_glib_none().0, x, y);
        }
    }

    fn set_source_window<W: IsA<Window>>(&self, window: &W, x: f64, y: f64) {
        unsafe {
            ffi::gdk_cairo_set_source_window(
                self.to_glib_none().0,
                window.as_ref().to_glib_none().0,
                x,
                y,
            );
        }
    }

    fn rectangle(&self, rectangle: &Rectangle) {
        unsafe {
            ffi::gdk_cairo_rectangle(self.to_glib_none().0, rectangle.to_glib_none().0);
        }
    }

    fn add_region(&self, region: &Region) {
        unsafe {
            ffi::gdk_cairo_region(self.to_glib_none().0, region.to_glib_none().0);
        }
    }
}
