use std::convert::From;
use std::error::Error as ErrorTrait;
use std::ffi::NulError;
use std::fmt::{Display, Formatter, Result as FmtResult};
use std::io::Error as IoError;

/// This is a library-specific error that is returned by all calls to all APIs.
#[derive(Debug)]
pub enum Error {
    /// Provided string could not be coverted into `std::ffi::CString` because it contained null
    /// character.
    NullCharacter(NulError),
    /// The library could not be opened.
    OpeningLibraryError(IoError),
    /// The symbol could not be obtained.
    SymbolGettingError(IoError),
    /// Value of the symbol was null.
    NullSymbol,
    /// Address could not be matched to a dynamic link library
    AddrNotMatchingDll(IoError),
}

impl ErrorTrait for Error {
    fn source(&self) -> Option<&(dyn ErrorTrait + 'static)> {
        use self::Error::*;
        match *self {
            NullCharacter(ref val) => Some(val),
            OpeningLibraryError(_) | SymbolGettingError(_) | NullSymbol | AddrNotMatchingDll(_) => {
                None
            }
        }
    }
}

impl Display for Error {
    fn fmt(&self, f: &mut Formatter) -> FmtResult {
        use self::Error::*;

        match self {
            NullCharacter(_) => write!(f, "String had a null character"),
            OpeningLibraryError(msg) => write!(f, "Could not open library: {msg}"),
            SymbolGettingError(msg) => {
                write!(f, "Could not obtain symbol from the library: {msg}")
            }
            NullSymbol => write!(f, "The symbol is NULL"),
            AddrNotMatchingDll(_) => write!(f, "Address does not match any dynamic link library"),
        }
    }
}

impl From<NulError> for Error {
    fn from(val: NulError) -> Error {
        Error::NullCharacter(val)
    }
}
