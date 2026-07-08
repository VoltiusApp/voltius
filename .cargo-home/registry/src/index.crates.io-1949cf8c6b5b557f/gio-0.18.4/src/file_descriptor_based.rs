// Take a look at the license at the top of the repository in the LICENSE file.

#[cfg(unix)]
use std::os::unix::io::{AsRawFd, FromRawFd, RawFd};

use glib::{prelude::*, translate::*};
#[cfg(all(not(unix), docsrs))]
use socket::{AsRawFd, FromRawFd, IntoRawFd, RawFd};
use std::fmt;

glib::wrapper! {
    #[doc(alias = "GFileDescriptorBased")]
    pub struct FileDescriptorBased(Interface<ffi::GFileDescriptorBased, ffi::GFileDescriptorBasedIface>);

    match fn {
        type_ => || ffi::g_file_descriptor_based_get_type(),
    }
}

impl FileDescriptorBased {
    pub const NONE: Option<&'static FileDescriptorBased> = None;
}

impl AsRawFd for FileDescriptorBased {
    fn as_raw_fd(&self) -> RawFd {
        unsafe { ffi::g_file_descriptor_based_get_fd(self.to_glib_none().0) as _ }
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: super::IsA<super::FileDescriptorBased>> Sealed for T {}
}

pub trait FileDescriptorBasedExtManual:
    sealed::Sealed + IsA<FileDescriptorBased> + 'static
{
    #[doc(alias = "g_file_descriptor_based_get_fd")]
    #[doc(alias = "get_fd")]
    fn fd<T: FromRawFd>(&self) -> T {
        unsafe {
            T::from_raw_fd(ffi::g_file_descriptor_based_get_fd(
                self.as_ref().to_glib_none().0,
            ))
        }
    }
}

impl<O: IsA<FileDescriptorBased>> FileDescriptorBasedExtManual for O {}

impl fmt::Display for FileDescriptorBased {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("FileDescriptorBased")
    }
}
