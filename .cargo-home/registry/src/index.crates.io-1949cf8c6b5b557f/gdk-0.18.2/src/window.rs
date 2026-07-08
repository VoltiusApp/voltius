// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Cursor;
use crate::EventMask;
use crate::Visual;
use crate::Window;
use cairo::{self, Surface};
use glib::object::IsA;
use glib::translate::*;
use libc::{c_char, c_int};
use std::ptr;

use crate::{WindowType, WindowTypeHint, WindowWindowClass};

pub struct WindowAttr {
    pub title: Option<String>,
    pub event_mask: EventMask,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: i32,
    pub height: i32,
    pub wclass: WindowWindowClass,
    pub visual: Option<Visual>,
    pub window_type: WindowType,
    pub cursor: Option<Cursor>,
    pub override_redirect: bool,
    pub type_hint: Option<WindowTypeHint>,
}

impl Default for WindowAttr {
    fn default() -> Self {
        skip_assert_initialized!();
        Self {
            title: None,
            event_mask: EventMask::empty(),
            x: None,
            y: None,
            width: 400,
            height: 300,
            wclass: WindowWindowClass::InputOutput,
            visual: None,
            window_type: WindowType::Toplevel,
            cursor: None,
            override_redirect: false,
            type_hint: None,
        }
    }
}

impl WindowAttr {
    #[doc(alias = "get_mask")]
    fn mask(&self) -> u32 {
        let mut mask: ffi::GdkWindowAttributesType = 0;
        if self.title.is_some() {
            mask |= ffi::GDK_WA_TITLE;
        }
        if self.x.is_some() {
            mask |= ffi::GDK_WA_X;
        }
        if self.y.is_some() {
            mask |= ffi::GDK_WA_Y;
        }
        if self.cursor.is_some() {
            mask |= ffi::GDK_WA_CURSOR;
        }
        if self.visual.is_some() {
            mask |= ffi::GDK_WA_VISUAL;
        }
        if self.override_redirect {
            mask |= ffi::GDK_WA_NOREDIR;
        }
        if self.type_hint.is_some() {
            mask |= ffi::GDK_WA_TYPE_HINT;
        }
        mask
    }
}

#[allow(clippy::type_complexity)]
impl<'a> ToGlibPtr<'a, *mut ffi::GdkWindowAttr> for WindowAttr {
    type Storage = (
        Box<ffi::GdkWindowAttr>,
        Stash<'a, *mut ffi::GdkVisual, Option<Visual>>,
        Stash<'a, *mut ffi::GdkCursor, Option<Cursor>>,
        Stash<'a, *const c_char, Option<String>>,
    );

    fn to_glib_none(&'a self) -> Stash<'a, *mut ffi::GdkWindowAttr, Self> {
        let title = self.title.to_glib_none();
        let visual = self.visual.to_glib_none();
        let cursor = self.cursor.to_glib_none();

        let mut attrs = Box::new(ffi::GdkWindowAttr {
            title: title.0 as *mut c_char,
            event_mask: self.event_mask.bits() as i32,
            x: self.x.unwrap_or(0),
            y: self.y.unwrap_or(0),
            width: self.width,
            height: self.height,
            wclass: self.wclass.into_glib(),
            visual: visual.0,
            window_type: self.window_type.into_glib(),
            cursor: cursor.0,
            wmclass_name: ptr::null_mut(),
            wmclass_class: ptr::null_mut(),
            override_redirect: self.override_redirect.into_glib(),
            type_hint: self.type_hint.unwrap_or(WindowTypeHint::Normal).into_glib(),
        });

        Stash(&mut *attrs, (attrs, visual, cursor, title))
    }
}

impl Window {
    #[doc(alias = "gdk_window_new")]
    pub fn new(parent: Option<&Window>, attributes: &WindowAttr) -> Window {
        assert_initialized_main_thread!();
        unsafe {
            from_glib_full(ffi::gdk_window_new(
                parent.to_glib_none().0,
                attributes.to_glib_none().0,
                attributes.mask() as c_int,
            ))
        }
    }

    #[doc(alias = "gdk_window_create_similar_surface")]
    pub fn create_similar_surface(
        &self,
        content: cairo::Content,
        width: i32,
        height: i32,
    ) -> Option<Surface> {
        unsafe {
            from_glib_full(ffi::gdk_window_create_similar_surface(
                self.to_glib_none().0,
                content.into(),
                width,
                height,
            ))
        }
    }

    #[doc(alias = "gdk_window_create_similar_image_surface")]
    pub fn create_similar_image_surface(
        &self,
        format: cairo::Format,
        width: i32,
        height: i32,
        scale: i32,
    ) -> Option<cairo::Surface> {
        unsafe {
            from_glib_full(ffi::gdk_window_create_similar_image_surface(
                self.to_glib_none().0,
                format.into(),
                width,
                height,
                scale,
            ))
        }
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::Window>> Sealed for T {}
}

pub trait WindowExtManual: IsA<Window> + sealed::Sealed + 'static {
    #[doc(alias = "gdk_window_set_user_data")]
    unsafe fn set_user_data<T>(&self, user_data: &mut T) {
        ffi::gdk_window_set_user_data(
            self.as_ref().to_glib_none().0,
            user_data as *mut T as *mut _,
        )
    }

    #[allow(clippy::mut_from_ref)]
    #[doc(alias = "gdk_window_get_user_data")]
    #[doc(alias = "get_user_data")]
    unsafe fn user_data<T>(&self) -> &mut T {
        let mut pointer = ::std::ptr::null_mut();
        ffi::gdk_window_get_user_data(self.as_ref().to_glib_none().0, &mut pointer);
        &mut *(pointer as *mut T)
    }

    #[doc(alias = "gdk_get_default_root_window")]
    #[doc(alias = "get_default_root_window")]
    fn default_root_window() -> Window {
        assert_initialized_main_thread!();
        unsafe { from_glib_none(ffi::gdk_get_default_root_window()) }
    }

    #[doc(alias = "gdk_offscreen_window_set_embedder")]
    fn offscreen_window_set_embedder(&self, embedder: &Window) {
        unsafe {
            ffi::gdk_offscreen_window_set_embedder(
                self.as_ref().to_glib_none().0,
                embedder.to_glib_none().0,
            )
        }
    }

    #[doc(alias = "gdk_offscreen_window_get_embedder")]
    fn offscreen_window_get_embedder(&self) -> Option<Window> {
        unsafe {
            from_glib_none(ffi::gdk_offscreen_window_get_embedder(
                self.as_ref().to_glib_none().0,
            ))
        }
    }

    #[doc(alias = "gdk_offscreen_window_get_surface")]
    fn offscreen_window_get_surface(&self) -> Option<Surface> {
        skip_assert_initialized!();
        unsafe {
            from_glib_none(ffi::gdk_offscreen_window_get_surface(
                self.as_ref().to_glib_none().0,
            ))
        }
    }

    #[doc(alias = "gdk_pixbuf_get_from_window")]
    #[doc(alias = "get_pixbuf")]
    fn pixbuf(
        &self,
        src_x: i32,
        src_y: i32,
        width: i32,
        height: i32,
    ) -> Option<gdk_pixbuf::Pixbuf> {
        skip_assert_initialized!();
        unsafe {
            from_glib_full(ffi::gdk_pixbuf_get_from_window(
                self.as_ref().to_glib_none().0,
                src_x,
                src_y,
                width,
                height,
            ))
        }
    }

    #[doc(alias = "gdk_window_get_background_pattern")]
    #[doc(alias = "get_background_pattern")]
    fn background_pattern(&self) -> Option<cairo::Pattern> {
        unsafe {
            let ret = ffi::gdk_window_get_background_pattern(self.as_ref().to_glib_none().0);
            if ret.is_null() {
                None
            } else {
                Some(cairo::Pattern::from_raw_none(ret))
            }
        }
    }

    #[doc(alias = "gdk_window_set_background_pattern")]
    fn set_background_pattern(&self, pattern: Option<&cairo::Pattern>) {
        unsafe {
            let ptr = if let Some(pattern) = pattern {
                pattern.to_raw_none()
            } else {
                ::std::ptr::null_mut()
            };
            ffi::gdk_window_set_background_pattern(self.as_ref().to_glib_none().0, ptr);
        }
    }
}

impl<O: IsA<Window>> WindowExtManual for O {}
