use glib::error::ErrorDomain;
use glib::translate::*;

use crate::Error;

impl ErrorDomain for Error {
    fn domain() -> glib::Quark {
        unsafe { from_glib(ffi::secret_error_get_quark()) }
    }

    fn code(self) -> i32 {
        self.into_glib()
    }

    fn from(code: i32) -> Option<Self> {
        match code {
            ffi::SECRET_ERROR_PROTOCOL => Some(Self::Protocol),
            ffi::SECRET_ERROR_IS_LOCKED => Some(Self::IsLocked),
            ffi::SECRET_ERROR_NO_SUCH_OBJECT => Some(Self::NoSuchObject),
            ffi::SECRET_ERROR_ALREADY_EXISTS => Some(Self::AlreadyExists),
            ffi::SECRET_ERROR_INVALID_FILE_FORMAT => Some(Self::InvalidFileFormat),
            value => Some(Self::__Unknown(value)),
        }
    }
}
