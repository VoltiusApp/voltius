// Take a look at the license at the top of the repository in the LICENSE file.

use crate::TextBuffer;
use crate::TextChildAnchor;
use crate::TextIter;
use crate::TextTag;
use glib::object::{Cast, IsA};
use glib::signal::{connect_raw, SignalHandlerId};
use glib::translate::*;
use libc::{c_char, c_int};
use std::boxed::Box as Box_;
use std::mem::transmute;
use std::{slice, str};

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::TextBuffer>> Sealed for T {}
}

pub trait TextBufferExtManual: IsA<TextBuffer> + sealed::Sealed + 'static {
    fn connect_apply_tag<F: Fn(&Self, &TextTag, &mut TextIter, &mut TextIter) + 'static>(
        &self,
        f: F,
    ) -> SignalHandlerId {
        unsafe extern "C" fn apply_tag_trampoline<
            P,
            F: Fn(&P, &TextTag, &mut TextIter, &mut TextIter) + 'static,
        >(
            this: *mut ffi::GtkTextBuffer,
            tag: *mut ffi::GtkTextTag,
            start: *mut ffi::GtkTextIter,
            end: *mut ffi::GtkTextIter,
            f: glib::ffi::gpointer,
        ) where
            P: IsA<TextBuffer>,
        {
            let f: &F = &*(f as *const F);
            let mut start_copy = from_glib_none(start);
            let mut end_copy = from_glib_none(end);

            f(
                TextBuffer::from_glib_borrow(this).unsafe_cast_ref(),
                &from_glib_borrow(tag),
                &mut start_copy,
                &mut end_copy,
            );

            *start = *start_copy.to_glib_none().0;
            *end = *end_copy.to_glib_none().0;
        }
        unsafe {
            let f: Box_<F> = Box_::new(f);
            connect_raw(
                self.as_ptr() as *mut _,
                b"apply-tag\0".as_ptr() as *const _,
                Some(transmute::<_, unsafe extern "C" fn()>(
                    apply_tag_trampoline::<Self, F> as *const (),
                )),
                Box_::into_raw(f),
            )
        }
    }

    fn connect_delete_range<F: Fn(&Self, &mut TextIter, &mut TextIter) + 'static>(
        &self,
        f: F,
    ) -> SignalHandlerId {
        unsafe extern "C" fn delete_range_trampoline<
            P,
            F: Fn(&P, &mut TextIter, &mut TextIter) + 'static,
        >(
            this: *mut ffi::GtkTextBuffer,
            start: *mut ffi::GtkTextIter,
            end: *mut ffi::GtkTextIter,
            f: glib::ffi::gpointer,
        ) where
            P: IsA<TextBuffer>,
        {
            let f: &F = &*(f as *const F);
            let mut start_copy = from_glib_none(start);
            let mut end_copy = from_glib_none(end);

            f(
                TextBuffer::from_glib_borrow(this).unsafe_cast_ref(),
                &mut start_copy,
                &mut end_copy,
            );

            *start = *start_copy.to_glib_none().0;
            *end = *end_copy.to_glib_none().0;
        }
        unsafe {
            let f: Box_<F> = Box_::new(f);
            connect_raw(
                self.as_ptr() as *mut _,
                b"delete-range\0".as_ptr() as *const _,
                Some(transmute::<_, unsafe extern "C" fn()>(
                    delete_range_trampoline::<Self, F> as *const (),
                )),
                Box_::into_raw(f),
            )
        }
    }

    fn connect_insert_child_anchor<F: Fn(&Self, &mut TextIter, &TextChildAnchor) + 'static>(
        &self,
        f: F,
    ) -> SignalHandlerId {
        unsafe extern "C" fn insert_child_anchor_trampoline<
            P,
            F: Fn(&P, &mut TextIter, &TextChildAnchor) + 'static,
        >(
            this: *mut ffi::GtkTextBuffer,
            location: *mut ffi::GtkTextIter,
            anchor: *mut ffi::GtkTextChildAnchor,
            f: glib::ffi::gpointer,
        ) where
            P: IsA<TextBuffer>,
        {
            let f: &F = &*(f as *const F);
            let mut location_copy = from_glib_none(location);

            f(
                TextBuffer::from_glib_borrow(this).unsafe_cast_ref(),
                &mut location_copy,
                &from_glib_borrow(anchor),
            );

            *location = *location_copy.to_glib_none().0;
        }
        unsafe {
            let f: Box_<F> = Box_::new(f);
            connect_raw(
                self.as_ptr() as *mut _,
                b"insert-child-anchor\0".as_ptr() as *const _,
                Some(transmute::<_, unsafe extern "C" fn()>(
                    insert_child_anchor_trampoline::<Self, F> as *const (),
                )),
                Box_::into_raw(f),
            )
        }
    }

    fn connect_insert_pixbuf<F: Fn(&Self, &mut TextIter, &gdk_pixbuf::Pixbuf) + 'static>(
        &self,
        f: F,
    ) -> SignalHandlerId {
        unsafe extern "C" fn insert_pixbuf_trampoline<
            P,
            F: Fn(&P, &mut TextIter, &gdk_pixbuf::Pixbuf) + 'static,
        >(
            this: *mut ffi::GtkTextBuffer,
            location: *mut ffi::GtkTextIter,
            pixbuf: *mut gdk_pixbuf::ffi::GdkPixbuf,
            f: glib::ffi::gpointer,
        ) where
            P: IsA<TextBuffer>,
        {
            let f: &F = &*(f as *const F);
            let mut location_copy = from_glib_none(location);

            f(
                TextBuffer::from_glib_borrow(this).unsafe_cast_ref(),
                &mut location_copy,
                &from_glib_borrow(pixbuf),
            );

            *location = *location_copy.to_glib_none().0;
        }
        unsafe {
            let f: Box_<F> = Box_::new(f);
            connect_raw(
                self.as_ptr() as *mut _,
                b"insert-pixbuf\0".as_ptr() as *const _,
                Some(transmute::<_, unsafe extern "C" fn()>(
                    insert_pixbuf_trampoline::<Self, F> as *const (),
                )),
                Box_::into_raw(f),
            )
        }
    }

    fn connect_insert_text<F: Fn(&Self, &mut TextIter, &str) + 'static>(
        &self,
        f: F,
    ) -> SignalHandlerId {
        unsafe extern "C" fn insert_text_trampoline<T, F: Fn(&T, &mut TextIter, &str) + 'static>(
            this: *mut ffi::GtkTextBuffer,
            location: *mut ffi::GtkTextIter,
            text: *mut c_char,
            len: c_int,
            f: glib::ffi::gpointer,
        ) where
            T: IsA<TextBuffer>,
        {
            let f: &F = &*(f as *const F);
            let mut location_copy = from_glib_none(location);

            let text = if len <= 0 {
                &[]
            } else {
                slice::from_raw_parts(text as *const u8, len as usize)
            };

            f(
                TextBuffer::from_glib_borrow(this).unsafe_cast_ref(),
                &mut location_copy,
                str::from_utf8(text).unwrap(),
            );

            *location = *location_copy.to_glib_none().0;
        }
        unsafe {
            let f: Box_<F> = Box_::new(f);
            connect_raw(
                self.to_glib_none().0 as *mut _,
                b"insert-text\0".as_ptr() as *mut _,
                Some(transmute::<_, unsafe extern "C" fn()>(
                    insert_text_trampoline::<Self, F> as *const (),
                )),
                Box_::into_raw(f),
            )
        }
    }

    fn connect_remove_tag<F: Fn(&Self, &TextTag, &mut TextIter, &mut TextIter) + 'static>(
        &self,
        f: F,
    ) -> SignalHandlerId {
        unsafe extern "C" fn remove_tag_trampoline<
            P,
            F: Fn(&P, &TextTag, &mut TextIter, &mut TextIter) + 'static,
        >(
            this: *mut ffi::GtkTextBuffer,
            tag: *mut ffi::GtkTextTag,
            start: *mut ffi::GtkTextIter,
            end: *mut ffi::GtkTextIter,
            f: glib::ffi::gpointer,
        ) where
            P: IsA<TextBuffer>,
        {
            let f: &F = &*(f as *const F);
            let mut start_copy = from_glib_none(start);
            let mut end_copy = from_glib_none(end);

            f(
                TextBuffer::from_glib_borrow(this).unsafe_cast_ref(),
                &from_glib_borrow(tag),
                &mut start_copy,
                &mut end_copy,
            );

            *start = *start_copy.to_glib_none().0;
            *end = *end_copy.to_glib_none().0;
        }
        unsafe {
            let f: Box_<F> = Box_::new(f);
            connect_raw(
                self.as_ptr() as *mut _,
                b"remove-tag\0".as_ptr() as *const _,
                Some(transmute::<_, unsafe extern "C" fn()>(
                    remove_tag_trampoline::<Self, F> as *const (),
                )),
                Box_::into_raw(f),
            )
        }
    }
}

impl<O: IsA<TextBuffer>> TextBufferExtManual for O {}
