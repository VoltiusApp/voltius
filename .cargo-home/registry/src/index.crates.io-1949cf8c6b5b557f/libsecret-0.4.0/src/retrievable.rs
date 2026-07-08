use std::collections::HashMap;

use crate::Retrievable;
use glib::translate::*;
use glib::IsA;

pub trait RetrievableExtManual: 'static {
    #[doc(alias = "secret_retrievable_get_attributes")]
    #[doc(alias = "get_attributes")]
    fn attributes(&self) -> HashMap<String, String>;
}

impl<O: IsA<Retrievable>> RetrievableExtManual for O {
    fn attributes(&self) -> HashMap<String, String> {
        unsafe {
            let table = ffi::secret_retrievable_get_attributes(self.as_ref().to_glib_none().0);
            FromGlibPtrContainer::from_glib_full(table)
        }
    }
}
