use super::super::err::Error;
use super::from_raw::{FromRawResult, RawResult};

impl<T> FromRawResult for Option<T>
where
    T: FromRawResult,
{
    unsafe fn from_raw_result(raw_result: RawResult) -> Result<Option<T>, Error> {
        unsafe {
            match T::from_raw_result(raw_result) {
                Ok(val) => Ok(Some(val)),
                Err(_) => Ok(None),
            }
        }
    }
}
