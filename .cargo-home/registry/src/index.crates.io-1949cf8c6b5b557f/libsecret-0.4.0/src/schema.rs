use crate::{Schema, SchemaAttributeType, SchemaFlags};
use glib::translate::*;
use std::collections::HashMap;

impl Schema {
    #[doc(alias = "secret_schema_new")]
    #[doc(alias = "secret_schema_newv")]
    pub fn new(
        name: &str,
        flags: SchemaFlags,
        attribute_names_and_types: HashMap<&str, SchemaAttributeType>,
    ) -> Self {
        unsafe {
            let hash_table = glib::ffi::g_hash_table_new_full(
                Some(glib::ffi::g_str_hash),
                Some(glib::ffi::g_str_equal),
                Some(glib::ffi::g_free),
                None,
            );

            for (name, type_) in attribute_names_and_types {
                let key_ptr: *mut libc::c_char = name.to_glib_full();
                glib::ffi::g_hash_table_insert(
                    hash_table,
                    key_ptr as *mut _,
                    type_.into_glib() as *mut _,
                );
            }

            from_glib_full(ffi::secret_schema_newv(
                name.to_glib_none().0,
                flags.into_glib(),
                hash_table,
            ))
        }
    }
}
