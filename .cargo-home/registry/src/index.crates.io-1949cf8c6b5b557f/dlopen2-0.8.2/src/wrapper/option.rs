use super::super::Error;
use super::super::raw::Library;
use super::api::WrapperApi;

impl<T> WrapperApi for Option<T>
where
    T: WrapperApi,
{
    unsafe fn load(lib: &Library) -> Result<Self, Error> {
        unsafe {
            match T::load(lib) {
                Ok(val) => Ok(Some(val)),
                Err(_) => Ok(None),
            }
        }
    }
}
