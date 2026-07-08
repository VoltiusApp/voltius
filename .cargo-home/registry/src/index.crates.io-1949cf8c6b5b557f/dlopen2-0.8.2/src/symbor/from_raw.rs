use super::super::err::Error;
use super::ptr_or_null::PtrOrNull;
pub type RawResult<'a> = Result<PtrOrNull<'a, ()>, Error>;

/// Allows conversion of raw symbol result into the given symbol.
///
/// This trait needs to be implemented by all members of structures that implement
/// the `SymBorApi` trait. It is used to covert raw result obtained from library
/// into the given object accessible to the user.
///
/// **Note:** `Option<T> where T: FromRawResult` also implements `FromRawResult`.
/// This allows you to use options in structures implementing `SymBorApi`. If
/// the symbol is found, the variable contains `Some(symbol)`, otherwise `None`.
///
/// **Note:** You probably won't need to use it directly.
pub trait FromRawResult
where
    Self: Sized,
{
    unsafe fn from_raw_result(raw: RawResult) -> Result<Self, Error>;
}
