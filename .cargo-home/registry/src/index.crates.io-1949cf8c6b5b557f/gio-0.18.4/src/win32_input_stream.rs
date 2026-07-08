// Take a look at the license at the top of the repository in the LICENSE file.

use std::{
    fmt,
    os::windows::io::{AsRawHandle, FromRawHandle, IntoRawHandle, RawHandle},
};

use glib::{prelude::*, translate::*};

use crate::InputStream;

glib::wrapper! {
    pub struct Win32InputStream(Object<ffi::GWin32InputStream, ffi::GWin32InputStreamClass>) @extends InputStream;

    match fn {
        type_ => || ffi::g_win32_input_stream_get_type(),
    }
}

pub trait Win32InputStreamExt: 'static {
    #[doc(alias = "g_win32_input_stream_get_close_handle")]
    #[doc(alias = "get_close_handle")]
    fn closes_handle(&self) -> bool;
}

impl<O: IsA<Win32InputStream>> Win32InputStreamExt for O {
    fn closes_handle(&self) -> bool {
        unsafe {
            from_glib(ffi::g_win32_input_stream_get_close_handle(
                self.as_ref().to_glib_none().0,
            ))
        }
    }
}

impl fmt::Display for Win32InputStream {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("Win32InputStream")
    }
}

impl Win32InputStream {
    pub const NONE: Option<&'static Win32InputStream> = None;

    // rustdoc-stripper-ignore-next
    /// Creates a new [`Self`] that takes ownership of the passed in handle.
    ///
    /// # Safety
    /// You must not close the handle unless you've previously called [`Win32InputStreamExtManual::set_close_handle`]
    /// with `true` on this stream. At which point you may only do so when all references to this
    /// stream have been dropped.
    #[doc(alias = "g_win32_input_stream_new")]
    pub unsafe fn take_handle(handle: impl IntoRawHandle) -> Win32InputStream {
        let handle = handle.into_raw_handle();
        let close_handle = true.into_glib();
        InputStream::from_glib_full(ffi::g_win32_input_stream_new(handle, close_handle))
            .unsafe_cast()
    }

    // rustdoc-stripper-ignore-next
    /// Creates a new [`Self`] that does not take ownership of the passed in handle.
    ///
    /// # Safety
    /// You may only close the handle if all references to this stream have been dropped.
    #[doc(alias = "g_win32_input_stream_new")]
    pub unsafe fn with_handle<T: AsRawHandle>(handle: T) -> Win32InputStream {
        let handle = handle.as_raw_handle();
        let close_handle = false.into_glib();
        InputStream::from_glib_full(ffi::g_win32_input_stream_new(handle, close_handle))
            .unsafe_cast()
    }
}

impl AsRawHandle for Win32InputStream {
    fn as_raw_handle(&self) -> RawHandle {
        unsafe { ffi::g_win32_input_stream_get_handle(self.to_glib_none().0) as _ }
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: super::IsA<super::Win32InputStream>> Sealed for T {}
}

pub trait Win32InputStreamExtManual: sealed::Sealed + IsA<Win32InputStream> + Sized {
    #[doc(alias = "g_win32_input_stream_get_handle")]
    #[doc(alias = "get_handle")]
    fn handle<T: FromRawHandle>(&self) -> T {
        unsafe {
            T::from_raw_handle(ffi::g_win32_input_stream_get_handle(
                self.as_ref().to_glib_none().0,
            ))
        }
    }

    // rustdoc-stripper-ignore-next
    /// Sets whether the handle of this stream will be closed when the stream is closed.
    ///
    /// # Safety
    /// If you pass in `false` as the parameter, you may only close the handle if the all references
    /// to the stream have been dropped. If you pass in `true`, you must never call close.
    #[doc(alias = "g_win32_input_stream_set_close_handle")]
    unsafe fn set_close_handle(&self, close_handle: bool) {
        ffi::g_win32_input_stream_set_close_handle(
            self.as_ref().to_glib_none().0,
            close_handle.into_glib(),
        );
    }
}

impl<O: IsA<Win32InputStream>> Win32InputStreamExtManual for O {}
