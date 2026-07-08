use glib::translate::*;
use std::collections::HashMap;

use crate::Value;

pub(crate) unsafe fn attribute_names_and_values(
    entry: HashMap<&str, &str>,
) -> *mut glib::ffi::GHashTable {
    let hash_table = glib::ffi::g_hash_table_new_full(
        Some(glib::ffi::g_str_hash),
        Some(glib::ffi::g_str_equal),
        Some(glib::ffi::g_free),
        Some(glib::ffi::g_free),
    );

    for (key, val) in entry {
        let key_ptr: *mut libc::c_char = key.to_glib_full();
        let val_ptr: *mut libc::c_char = val.to_glib_full();
        glib::ffi::g_hash_table_insert(hash_table, key_ptr as *mut _, val_ptr as *mut _);
    }

    hash_table
}

pub(crate) unsafe fn attribute_names_and_properties(
    hash_map: HashMap<&str, &glib::Variant>,
) -> *mut glib::ffi::GHashTable {
    let hash_table = glib::ffi::g_hash_table_new_full(
        Some(glib::ffi::g_str_hash),
        Some(glib::ffi::g_str_equal),
        Some(glib::ffi::g_free),
        Some(glib::ffi::g_free),
    );

    for (name, value) in hash_map {
        let key_ptr: *mut libc::c_char = name.to_glib_full();
        glib::ffi::g_hash_table_insert(hash_table, key_ptr as *mut _, value.as_ptr() as _);
    }

    hash_table
}

pub(crate) unsafe fn hash_map_from_glib_none(
    ptr: *mut glib::ffi::GHashTable,
) -> HashMap<String, Value> {
    unsafe extern "C" fn read_string_hash_table(
        key: glib::ffi::gpointer,
        value: glib::ffi::gpointer,
        hash_map: glib::ffi::gpointer,
    ) {
        let key: String = from_glib_none(key as *const libc::c_char);
        let value: Value = from_glib_none(value as *const ffi::SecretValue);
        let hash_map: &mut HashMap<String, Value> = &mut *(hash_map as *mut HashMap<String, Value>);
        hash_map.insert(key, value);
    }
    let mut map = HashMap::with_capacity(glib::ffi::g_hash_table_size(ptr) as usize);
    glib::ffi::g_hash_table_foreach(
        ptr,
        Some(read_string_hash_table),
        &mut map as *mut HashMap<String, Value> as *mut _,
    );
    map
}
