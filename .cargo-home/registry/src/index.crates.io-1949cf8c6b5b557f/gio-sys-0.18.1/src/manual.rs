// Take a look at the license at the top of the repository in the LICENSE file.

#[cfg(not(target_family = "windows"))]
pub use self::libc_constants::*;
#[cfg(target_family = "windows")]
pub use self::windows_constants::*;

pub type GSocketFamily = libc::c_int;
pub type GSocketMsgFlags = libc::c_int;

#[cfg(target_family = "windows")]
mod windows_constants {
    pub const G_SOCKET_FAMILY_INVALID: super::GSocketFamily = winapi::shared::ws2def::AF_UNSPEC;
    pub const G_SOCKET_FAMILY_UNIX: super::GSocketFamily = winapi::shared::ws2def::AF_UNIX;
    pub const G_SOCKET_FAMILY_IPV4: super::GSocketFamily = winapi::shared::ws2def::AF_INET;
    pub const G_SOCKET_FAMILY_IPV6: super::GSocketFamily = winapi::shared::ws2def::AF_INET6;

    pub const G_SOCKET_MSG_NONE: super::GSocketMsgFlags = 0;
    pub const G_SOCKET_MSG_OOB: super::GSocketMsgFlags = winapi::um::winsock2::MSG_OOB;
    pub const G_SOCKET_MSG_PEEK: super::GSocketMsgFlags = winapi::um::winsock2::MSG_PEEK;
    pub const G_SOCKET_MSG_DONTROUTE: super::GSocketMsgFlags = winapi::um::winsock2::MSG_DONTROUTE;
}

#[cfg(not(target_family = "windows"))]
mod libc_constants {
    pub const G_SOCKET_FAMILY_INVALID: super::GSocketFamily = libc::AF_UNSPEC;
    pub const G_SOCKET_FAMILY_UNIX: super::GSocketFamily = libc::AF_UNIX;
    pub const G_SOCKET_FAMILY_IPV4: super::GSocketFamily = libc::AF_INET;
    pub const G_SOCKET_FAMILY_IPV6: super::GSocketFamily = libc::AF_INET6;

    pub const G_SOCKET_MSG_NONE: super::GSocketMsgFlags = 0;
    pub const G_SOCKET_MSG_OOB: super::GSocketMsgFlags = libc::MSG_OOB;
    pub const G_SOCKET_MSG_PEEK: super::GSocketMsgFlags = libc::MSG_PEEK;
    pub const G_SOCKET_MSG_DONTROUTE: super::GSocketMsgFlags = libc::MSG_DONTROUTE;
}

#[cfg(target_family = "windows")]
pub use self::windows_streams::*;

#[cfg(target_family = "windows")]
mod windows_streams {
    use libc::c_void;

    use crate::{
        gboolean, GInputStream, GInputStreamClass, GOutputStream, GOutputStreamClass, GType,
    };

    #[link(name = "gio-2.0")]
    extern "C" {
        //=========================================================================
        // GWin32InputStream
        //=========================================================================
        pub fn g_win32_input_stream_get_type() -> GType;
        pub fn g_win32_input_stream_new(
            handle: *mut c_void,
            close_handle: gboolean,
        ) -> *mut GInputStream;
        pub fn g_win32_input_stream_get_close_handle(stream: *mut GWin32InputStream) -> gboolean;
        pub fn g_win32_input_stream_get_handle(stream: *mut GWin32InputStream) -> *mut c_void;
        pub fn g_win32_input_stream_set_close_handle(
            stream: *mut GWin32InputStream,
            close_handle: gboolean,
        );

        //=========================================================================
        // GWin32OutputStream
        //=========================================================================
        pub fn g_win32_output_stream_get_type() -> GType;
        pub fn g_win32_output_stream_new(
            handle: *mut c_void,
            close_handle: gboolean,
        ) -> *mut GOutputStream;
        pub fn g_win32_output_stream_get_close_handle(stream: *mut GWin32OutputStream) -> gboolean;
        pub fn g_win32_output_stream_get_handle(stream: *mut GWin32OutputStream) -> *mut c_void;
        pub fn g_win32_output_stream_set_close_handle(
            stream: *mut GWin32OutputStream,
            close_handle: gboolean,
        );
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct GWin32InputStreamClass {
        pub parent_class: GInputStreamClass,
        pub _g_reserved1: Option<unsafe extern "C" fn()>,
        pub _g_reserved2: Option<unsafe extern "C" fn()>,
        pub _g_reserved3: Option<unsafe extern "C" fn()>,
        pub _g_reserved4: Option<unsafe extern "C" fn()>,
        pub _g_reserved5: Option<unsafe extern "C" fn()>,
    }

    impl ::std::fmt::Debug for GWin32InputStreamClass {
        fn fmt(&self, f: &mut ::std::fmt::Formatter) -> ::std::fmt::Result {
            f.debug_struct(&format!("GWin32InputStreamClass @ {:?}", self as *const _))
                .field("parent_class", &self.parent_class)
                .field("_g_reserved1", &self._g_reserved1)
                .field("_g_reserved2", &self._g_reserved2)
                .field("_g_reserved3", &self._g_reserved3)
                .field("_g_reserved4", &self._g_reserved4)
                .field("_g_reserved5", &self._g_reserved5)
                .finish()
        }
    }

    #[repr(C)]
    pub struct _GWin32InputStreamPrivate(c_void);

    pub type GWin32InputStreamPrivate = *mut _GWin32InputStreamPrivate;

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct GWin32InputStream {
        pub parent_instance: GInputStream,
        pub priv_: *mut GWin32InputStreamPrivate,
    }

    impl ::std::fmt::Debug for GWin32InputStream {
        fn fmt(&self, f: &mut ::std::fmt::Formatter) -> ::std::fmt::Result {
            f.debug_struct(&format!("GWin32InputStream @ {:?}", self as *const _))
                .field("parent_instance", &self.parent_instance)
                .finish()
        }
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct GWin32OutputStreamClass {
        pub parent_class: GOutputStreamClass,
        pub _g_reserved1: Option<unsafe extern "C" fn()>,
        pub _g_reserved2: Option<unsafe extern "C" fn()>,
        pub _g_reserved3: Option<unsafe extern "C" fn()>,
        pub _g_reserved4: Option<unsafe extern "C" fn()>,
        pub _g_reserved5: Option<unsafe extern "C" fn()>,
    }

    impl ::std::fmt::Debug for GWin32OutputStreamClass {
        fn fmt(&self, f: &mut ::std::fmt::Formatter) -> ::std::fmt::Result {
            f.debug_struct(&format!("GWin32OutputStreamClass @ {:?}", self as *const _))
                .field("parent_class", &self.parent_class)
                .field("_g_reserved1", &self._g_reserved1)
                .field("_g_reserved2", &self._g_reserved2)
                .field("_g_reserved3", &self._g_reserved3)
                .field("_g_reserved4", &self._g_reserved4)
                .field("_g_reserved5", &self._g_reserved5)
                .finish()
        }
    }

    #[repr(C)]
    pub struct _GWin32OutputStreamPrivate(c_void);

    pub type GWin32OutputStreamPrivate = *mut _GWin32OutputStreamPrivate;

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct GWin32OutputStream {
        pub parent_instance: GOutputStream,
        pub priv_: *mut GWin32OutputStreamPrivate,
    }

    impl ::std::fmt::Debug for GWin32OutputStream {
        fn fmt(&self, f: &mut ::std::fmt::Formatter) -> ::std::fmt::Result {
            f.debug_struct(&format!("GWin32OutputStream @ {:?}", self as *const _))
                .field("parent_instance", &self.parent_instance)
                .finish()
        }
    }
}
