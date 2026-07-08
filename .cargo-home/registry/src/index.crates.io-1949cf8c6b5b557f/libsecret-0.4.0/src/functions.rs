use std::boxed::Box as Box_;
use std::collections::HashMap;

use crate::{hashtable::attribute_names_and_values, Schema};
#[cfg(any(feature = "v0_19", feature = "dox"))]
#[cfg_attr(feature = "dox", doc(cfg(feature = "v0_19")))]
use crate::{Retrievable, SearchFlags, Value};
use glib::{translate::*, IsA};

#[doc(alias = "secret_password_clearv_sync")]
#[doc(alias = "secret_password_clear_sync")]
#[doc(alias = "password_clearv_sync")]
pub fn password_clear_sync(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
) -> Result<(), glib::Error> {
    unsafe {
        let mut err = std::ptr::null_mut();
        ffi::secret_password_clearv_sync(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            &mut err,
        );
        if err.is_null() {
            Ok(())
        } else {
            Err(from_glib_full(err))
        }
    }
}

#[cfg(any(feature = "v0_19", feature = "dox"))]
#[cfg_attr(feature = "dox", doc(cfg(feature = "v0_19")))]
#[doc(alias = "secret_password_lookupv_binary_sync")]
#[doc(alias = "secret_password_lookup_binary_sync")]
#[doc(alias = "password_lookupv_binary_sync")]
pub fn password_lookup_binary_sync(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
) -> Result<Option<Value>, glib::Error> {
    unsafe {
        let mut err = std::ptr::null_mut();
        let value = ffi::secret_password_lookupv_binary_sync(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            &mut err,
        );
        if err.is_null() {
            Ok(from_glib_full(value))
        } else {
            Err(from_glib_full(err))
        }
    }
}

#[doc(alias = "secret_password_lookupv_nonpageable_sync")]
#[doc(alias = "secret_password_lookup_nonpageable_sync")]
#[doc(alias = "password_lookupv_nonpageable_sync")]
pub fn password_lookup_nonpageable_sync(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
) -> Result<glib::GString, glib::Error> {
    unsafe {
        let mut err = std::ptr::null_mut();
        let res = ffi::secret_password_lookupv_nonpageable_sync(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            &mut err,
        );
        if err.is_null() {
            Ok(from_glib_full(res))
        } else {
            Err(from_glib_full(err))
        }
    }
}

#[doc(alias = "secret_password_lookupv_sync")]
#[doc(alias = "secret_password_lookup_sync")]
#[doc(alias = "password_lookupv_sync")]
pub fn password_lookup_sync(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
) -> Result<Option<glib::GString>, glib::Error> {
    unsafe {
        let mut err = std::ptr::null_mut();
        let res = ffi::secret_password_lookupv_sync(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            &mut err,
        );
        if err.is_null() {
            Ok(from_glib_full(res))
        } else {
            Err(from_glib_full(err))
        }
    }
}

#[cfg(any(feature = "v0_19", feature = "dox"))]
#[cfg_attr(feature = "dox", doc(cfg(feature = "v0_19")))]
#[doc(alias = "secret_password_searchv_sync")]
#[doc(alias = "secret_password_search_sync")]
#[doc(alias = "password_searchv_sync")]
pub fn password_search_sync(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    flags: SearchFlags,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
) -> Result<Vec<Retrievable>, glib::Error> {
    unsafe {
        let mut err = std::ptr::null_mut();
        let res = ffi::secret_password_searchv_sync(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            flags.into_glib(),
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            &mut err,
        );
        if err.is_null() {
            Ok(FromGlibPtrContainer::from_glib_full(res))
        } else {
            Err(from_glib_full(err))
        }
    }
}

#[cfg(any(feature = "v0_19", feature = "dox"))]
#[cfg_attr(feature = "dox", doc(cfg(feature = "v0_19")))]
#[doc(alias = "secret_password_storev_binary_sync")]
#[doc(alias = "secret_password_store_binary_sync")]
#[doc(alias = "password_storev_binary_sync")]
pub fn password_store_binary_sync(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    collection: Option<&str>,
    label: &str,
    value: &Value,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
) -> Result<(), glib::Error> {
    unsafe {
        let mut err = std::ptr::null_mut();
        ffi::secret_password_storev_binary_sync(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            collection.to_glib_none().0,
            label.to_glib_none().0,
            value.to_glib_none().0,
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            &mut err,
        );
        if err.is_null() {
            Ok(())
        } else {
            Err(from_glib_full(err))
        }
    }
}

#[doc(alias = "secret_password_storev_sync")]
#[doc(alias = "secret_password_store_sync")]
#[doc(alias = "password_storev_sync")]
pub fn password_store_sync(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    collection: Option<&str>,
    label: &str,
    password: &str,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
) -> Result<(), glib::Error> {
    unsafe {
        let mut err = std::ptr::null_mut();
        ffi::secret_password_storev_sync(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            collection.to_glib_none().0,
            label.to_glib_none().0,
            password.to_glib_none().0,
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            &mut err,
        );
        if err.is_null() {
            Ok(())
        } else {
            Err(from_glib_full(err))
        }
    }
}

#[doc(alias = "secret_password_clearv")]
#[doc(alias = "secret_password_clear")]
#[doc(alias = "password_clearv")]
pub fn password_clear<P: FnOnce(Result<(), glib::Error>) + 'static>(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
    callback: P,
) {
    let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
        Box_::new(glib::thread_guard::ThreadGuard::new(callback));
    unsafe extern "C" fn trampoline<P: FnOnce(Result<(), glib::Error>) + 'static>(
        _source_object: *mut glib::gobject_ffi::GObject,
        res: *mut gio::ffi::GAsyncResult,
        user_data: glib::ffi::gpointer,
    ) {
        let mut err = std::ptr::null_mut();
        ffi::secret_password_clear_finish(res, &mut err);
        let result = if err.is_null() {
            Ok(())
        } else {
            Err(from_glib_full(err))
        };

        let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
            Box_::from_raw(user_data as *mut _);
        let callback: P = callback.into_inner();
        callback(result);
    }

    let callback = trampoline::<P>;
    unsafe {
        ffi::secret_password_clearv(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            Some(callback),
            Box_::into_raw(user_data) as *mut _,
        );
    }
}

#[doc(alias = "secret_password_clearv")]
#[doc(alias = "secret_password_clear")]
#[doc(alias = "password_clearv")]
pub async fn password_clear_future(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
) -> Result<(), glib::Error> {
    let schema = schema.map(ToOwned::to_owned);
    let owned_map = attributes
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect::<HashMap<String, String>>();
    gio::GioFuture::new(&(), move |_obj, cancellable, send| {
        let attributes = owned_map
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect::<HashMap<&str, &str>>();
        password_clear(
            schema.as_ref().map(::std::borrow::Borrow::borrow),
            attributes,
            Some(cancellable),
            move |res| {
                send.resolve(res);
            },
        );
    })
    .await
}

#[doc(alias = "secret_password_lookupv")]
#[doc(alias = "secret_password_lookup")]
#[doc(alias = "password_lookupv")]
pub fn password_lookup<P: FnOnce(Result<Option<glib::GString>, glib::Error>) + 'static>(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
    callback: P,
) {
    let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
        Box_::new(glib::thread_guard::ThreadGuard::new(callback));
    unsafe extern "C" fn trampoline<
        P: FnOnce(Result<Option<glib::GString>, glib::Error>) + 'static,
    >(
        _source_object: *mut glib::gobject_ffi::GObject,
        res: *mut gio::ffi::GAsyncResult,
        user_data: glib::ffi::gpointer,
    ) {
        let mut err = std::ptr::null_mut();
        let res = ffi::secret_password_lookup_finish(res, &mut err);
        let result = if err.is_null() {
            Ok(from_glib_full(res))
        } else {
            Err(from_glib_full(err))
        };
        let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
            Box_::from_raw(user_data as *mut _);
        let callback: P = callback.into_inner();
        callback(result);
    }

    let callback = trampoline::<P>;
    unsafe {
        ffi::secret_password_lookupv(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            Some(callback),
            Box_::into_raw(user_data) as *mut _,
        );
    }
}

#[doc(alias = "secret_password_lookupv")]
#[doc(alias = "secret_password_lookup")]
#[doc(alias = "password_lookupv")]
pub async fn password_lookup_future(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
) -> Result<Option<glib::GString>, glib::Error> {
    let schema = schema.map(ToOwned::to_owned);
    let owned_map = attributes
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect::<HashMap<String, String>>();
    gio::GioFuture::new(&(), move |_obj, cancellable, send| {
        let attributes = owned_map
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect::<HashMap<&str, &str>>();
        password_lookup(
            schema.as_ref().map(::std::borrow::Borrow::borrow),
            attributes,
            Some(cancellable),
            move |res| {
                send.resolve(res);
            },
        );
    })
    .await
}

#[cfg(any(feature = "v0_19", feature = "dox"))]
#[cfg_attr(feature = "dox", doc(cfg(feature = "v0_19")))]
#[doc(alias = "secret_password_lookupv_binary")]
#[doc(alias = "secret_password_lookup_binary")]
#[doc(alias = "password_lookupv_binary")]
pub fn password_lookup_binary<P: FnOnce(Result<Option<Value>, glib::Error>) + 'static>(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
    callback: P,
) {
    let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
        Box_::new(glib::thread_guard::ThreadGuard::new(callback));
    unsafe extern "C" fn trampoline<P: FnOnce(Result<Option<Value>, glib::Error>) + 'static>(
        _source_object: *mut glib::gobject_ffi::GObject,
        res: *mut gio::ffi::GAsyncResult,
        user_data: glib::ffi::gpointer,
    ) {
        let mut err = std::ptr::null_mut();
        let res = ffi::secret_password_lookup_binary_finish(res, &mut err);
        let result = if err.is_null() {
            Ok(from_glib_full(res))
        } else {
            Err(from_glib_full(err))
        };
        let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
            Box_::from_raw(user_data as *mut _);
        let callback: P = callback.into_inner();
        callback(result);
    }

    let callback = trampoline::<P>;
    unsafe {
        ffi::secret_password_lookupv(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            Some(callback),
            Box_::into_raw(user_data) as *mut _,
        );
    }
}

#[cfg(any(feature = "v0_19", feature = "dox"))]
#[cfg_attr(feature = "dox", doc(cfg(feature = "v0_19")))]
#[doc(alias = "secret_password_lookupv_binary")]
#[doc(alias = "secret_password_lookup_binary")]
#[doc(alias = "password_lookupv_binary")]
pub async fn password_lookup_binary_future(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
) -> Result<Option<Value>, glib::Error> {
    let schema = schema.map(ToOwned::to_owned);
    let owned_map = attributes
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect::<HashMap<String, String>>();
    gio::GioFuture::new(&(), move |_obj, cancellable, send| {
        let attributes = owned_map
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect::<HashMap<&str, &str>>();
        password_lookup_binary(
            schema.as_ref().map(::std::borrow::Borrow::borrow),
            attributes,
            Some(cancellable),
            move |res| {
                send.resolve(res);
            },
        );
    })
    .await
}

#[doc(alias = "secret_password_lookupv_nonpageable")]
#[doc(alias = "secret_password_lookup_nonpageable")]
#[doc(alias = "password_lookupv_nonpageable")]
pub fn password_lookup_nonpageable<
    P: FnOnce(Result<Option<glib::GString>, glib::Error>) + 'static,
>(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
    callback: P,
) {
    let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
        Box_::new(glib::thread_guard::ThreadGuard::new(callback));
    unsafe extern "C" fn trampoline<
        P: FnOnce(Result<Option<glib::GString>, glib::Error>) + 'static,
    >(
        _source_object: *mut glib::gobject_ffi::GObject,
        res: *mut gio::ffi::GAsyncResult,
        user_data: glib::ffi::gpointer,
    ) {
        let mut err = std::ptr::null_mut();
        let res = ffi::secret_password_lookup_nonpageable_finish(res, &mut err);
        let result = if err.is_null() {
            Ok(from_glib_full(res))
        } else {
            Err(from_glib_full(err))
        };
        let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
            Box_::from_raw(user_data as *mut _);
        let callback: P = callback.into_inner();
        callback(result);
    }

    let callback = trampoline::<P>;
    unsafe {
        ffi::secret_password_lookupv(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            Some(callback),
            Box_::into_raw(user_data) as *mut _,
        );
    }
}

#[doc(alias = "secret_password_lookupv_nonpageable")]
#[doc(alias = "secret_password_lookup_nonpageable")]
#[doc(alias = "password_lookupv_nonpageable")]
pub async fn password_lookup_nonpageable_future(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
) -> Result<Option<glib::GString>, glib::Error> {
    let schema = schema.map(ToOwned::to_owned);
    let owned_map = attributes
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect::<HashMap<String, String>>();
    gio::GioFuture::new(&(), move |_obj, cancellable, send| {
        let attributes = owned_map
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect::<HashMap<&str, &str>>();
        password_lookup_nonpageable(
            schema.as_ref().map(::std::borrow::Borrow::borrow),
            attributes,
            Some(cancellable),
            move |res| {
                send.resolve(res);
            },
        );
    })
    .await
}

#[doc(alias = "secret_password_storev")]
#[doc(alias = "secret_password_store")]
#[doc(alias = "password_storev")]
pub fn password_store<P: FnOnce(Result<(), glib::Error>) + 'static>(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    collection: Option<&str>,
    label: &str,
    password: &str,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
    callback: P,
) {
    let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
        Box_::new(glib::thread_guard::ThreadGuard::new(callback));
    unsafe extern "C" fn trampoline<P: FnOnce(Result<(), glib::Error>) + 'static>(
        _source_object: *mut glib::gobject_ffi::GObject,
        res: *mut gio::ffi::GAsyncResult,
        user_data: glib::ffi::gpointer,
    ) {
        let mut err = std::ptr::null_mut();
        ffi::secret_password_store_finish(res, &mut err);
        let result = if err.is_null() {
            Ok(())
        } else {
            Err(from_glib_full(err))
        };

        let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
            Box_::from_raw(user_data as *mut _);
        let callback: P = callback.into_inner();
        callback(result);
    }

    let callback = trampoline::<P>;
    unsafe {
        ffi::secret_password_storev(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            collection.to_glib_none().0,
            label.to_glib_none().0,
            password.to_glib_none().0,
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            Some(callback),
            Box_::into_raw(user_data) as *mut _,
        );
    }
}

#[doc(alias = "secret_password_storev")]
#[doc(alias = "secret_password_store")]
#[doc(alias = "password_storev")]
pub async fn password_store_future(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    collection: Option<&str>,
    label: &str,
    password: &str,
) -> Result<(), glib::Error> {
    let schema = schema.map(ToOwned::to_owned);
    let collection = collection.map(ToOwned::to_owned);
    let label = label.to_owned();
    let password = password.to_owned();
    let owned_map = attributes
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect::<HashMap<String, String>>();
    gio::GioFuture::new(&(), move |_obj, cancellable, send| {
        let attributes = owned_map
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect::<HashMap<&str, &str>>();
        password_store(
            schema.as_ref().map(::std::borrow::Borrow::borrow),
            attributes,
            collection.as_ref().map(::std::borrow::Borrow::borrow),
            &label,
            &password,
            Some(cancellable),
            move |res| {
                send.resolve(res);
            },
        );
    })
    .await
}

#[cfg(any(feature = "v0_19", feature = "dox"))]
#[cfg_attr(feature = "dox", doc(cfg(feature = "v0_19")))]
#[doc(alias = "secret_password_storev_binary")]
#[doc(alias = "secret_password_store_binary")]
#[doc(alias = "password_storev_binary")]
pub fn password_store_binary<P: FnOnce(Result<(), glib::Error>) + 'static>(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    collection: Option<&str>,
    label: &str,
    value: &Value,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
    callback: P,
) {
    let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
        Box_::new(glib::thread_guard::ThreadGuard::new(callback));
    unsafe extern "C" fn trampoline<P: FnOnce(Result<(), glib::Error>) + 'static>(
        _source_object: *mut glib::gobject_ffi::GObject,
        res: *mut gio::ffi::GAsyncResult,
        user_data: glib::ffi::gpointer,
    ) {
        let mut err = std::ptr::null_mut();
        let _ = ffi::secret_password_store_finish(res, &mut err);
        let result = if err.is_null() {
            Ok(())
        } else {
            Err(from_glib_full(err))
        };
        let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
            Box_::from_raw(user_data as *mut _);
        let callback: P = callback.into_inner();
        callback(result);
    }

    let callback = trampoline::<P>;
    unsafe {
        ffi::secret_password_storev_binary(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            collection.to_glib_none().0,
            label.to_glib_none().0,
            value.to_glib_none().0,
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            Some(callback),
            Box_::into_raw(user_data) as *mut _,
        );
    }
}

#[cfg(any(feature = "v0_19", feature = "dox"))]
#[cfg_attr(feature = "dox", doc(cfg(feature = "v0_19")))]
#[doc(alias = "secret_password_storev_binary")]
#[doc(alias = "secret_password_store_binary")]
#[doc(alias = "password_storev_binary")]
pub async fn password_store_binary_future(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    collection: Option<&str>,
    label: &str,
    value: &Value,
) -> Result<(), glib::Error> {
    let schema = schema.map(ToOwned::to_owned);
    let collection = collection.map(ToOwned::to_owned);
    let label = label.to_owned();
    let password = value.clone();
    let owned_map = attributes
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect::<HashMap<String, String>>();
    gio::GioFuture::new(&(), move |_obj, cancellable, send| {
        let attributes = owned_map
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect::<HashMap<&str, &str>>();
        password_store_binary(
            schema.as_ref().map(::std::borrow::Borrow::borrow),
            attributes,
            collection.as_ref().map(::std::borrow::Borrow::borrow),
            &label,
            &password,
            Some(cancellable),
            move |res| {
                send.resolve(res);
            },
        );
    })
    .await
}

#[cfg(any(feature = "v0_19", feature = "dox"))]
#[cfg_attr(feature = "dox", doc(cfg(feature = "v0_19")))]
#[doc(alias = "secret_password_searchv")]
#[doc(alias = "secret_password_search")]
#[doc(alias = "password_searchv")]
pub fn password_search<P: FnOnce(Result<Vec<Retrievable>, glib::Error>) + 'static>(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    flags: SearchFlags,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
    callback: P,
) {
    let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
        Box_::new(glib::thread_guard::ThreadGuard::new(callback));
    unsafe extern "C" fn trampoline<P: FnOnce(Result<Vec<Retrievable>, glib::Error>) + 'static>(
        _source_object: *mut glib::gobject_ffi::GObject,
        res: *mut gio::ffi::GAsyncResult,
        user_data: glib::ffi::gpointer,
    ) {
        let mut err = std::ptr::null_mut();
        let res = ffi::secret_password_search_finish(res, &mut err);
        let result = if err.is_null() {
            Ok(FromGlibPtrContainer::from_glib_full(res))
        } else {
            Err(from_glib_full(err))
        };

        let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
            Box_::from_raw(user_data as *mut _);
        let callback: P = callback.into_inner();
        callback(result);
    }

    let callback = trampoline::<P>;
    unsafe {
        ffi::secret_password_searchv(
            schema.to_glib_none().0,
            attribute_names_and_values(attributes),
            flags.into_glib(),
            cancellable.map(|c| c.as_ref()).to_glib_none().0,
            Some(callback),
            Box_::into_raw(user_data) as *mut _,
        );
    }
}

#[cfg(any(feature = "v0_19", feature = "dox"))]
#[cfg_attr(feature = "dox", doc(cfg(feature = "v0_19")))]
#[doc(alias = "secret_password_searchv")]
#[doc(alias = "secret_password_search")]
#[doc(alias = "password_searchv")]
pub async fn password_search_future(
    schema: Option<&Schema>,
    attributes: HashMap<&str, &str>,
    flags: SearchFlags,
) -> Result<Vec<Retrievable>, glib::Error> {
    let schema = schema.map(ToOwned::to_owned);
    let owned_map = attributes
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect::<HashMap<String, String>>();
    gio::GioFuture::new(&(), move |_obj, cancellable, send| {
        let attributes = owned_map
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect::<HashMap<&str, &str>>();
        password_search(
            schema.as_ref().map(::std::borrow::Borrow::borrow),
            attributes,
            flags,
            Some(cancellable),
            move |res| {
                send.resolve(res);
            },
        );
    })
    .await
}
