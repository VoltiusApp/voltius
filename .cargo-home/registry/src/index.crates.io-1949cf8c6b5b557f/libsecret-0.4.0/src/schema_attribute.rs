use crate::{SchemaAttribute, SchemaAttributeType};
use glib::translate::*;

impl SchemaAttribute {
    pub fn type_(&self) -> SchemaAttributeType {
        unsafe { from_glib((*(self.as_ptr())).type_) }
    }

    pub fn name(&self) -> glib::GString {
        unsafe { from_glib_none((*(self.as_ptr())).name) }
    }
}
