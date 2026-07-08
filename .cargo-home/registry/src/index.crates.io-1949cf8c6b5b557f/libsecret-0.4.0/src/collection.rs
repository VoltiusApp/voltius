// Take a look at the license at the top of the repository in the LICENSE file.

use crate::{hashtable::attribute_names_and_values, Item};
use crate::{Collection, Schema, SearchFlags};

use glib::translate::*;
use glib::IsA;

use std::boxed::Box as Box_;
use std::collections::HashMap;
use std::pin::Pin;
use std::ptr;

pub trait CollectionExtManual: 'static {
    #[doc(alias = "secret_collection_search")]
    fn search<P: FnOnce(Result<Vec<Item>, glib::Error>) + 'static>(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        flags: SearchFlags,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    );

    fn search_future(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        flags: SearchFlags,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<Vec<Item>, glib::Error>> + 'static>>;

    #[doc(alias = "secret_collection_search_sync")]
    fn search_sync(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        flags: SearchFlags,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
    ) -> Result<Vec<Item>, glib::Error>;

    #[doc(alias = "secret_collection_search_for_dbus_paths")]
    fn search_for_dbus_paths<P: FnOnce(Result<Vec<glib::GString>, glib::Error>) + 'static>(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    );

    fn search_for_dbus_paths_future(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
    ) -> Pin<
        Box_<dyn std::future::Future<Output = Result<Vec<glib::GString>, glib::Error>> + 'static>,
    >;

    #[doc(alias = "secret_collection_search_for_dbus_paths_sync")]
    fn search_for_dbus_paths_sync(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
    ) -> Result<Vec<glib::GString>, glib::Error>;
}

impl<O: IsA<Collection>> CollectionExtManual for O {
    fn search<P: FnOnce(Result<Vec<Item>, glib::Error>) + 'static>(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        flags: SearchFlags,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        unsafe {
            let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::new(glib::thread_guard::ThreadGuard::new(callback));
            unsafe extern "C" fn search_trampoline<
                P: FnOnce(Result<Vec<Item>, glib::Error>) + 'static,
            >(
                _source_object: *mut glib::gobject_ffi::GObject,
                res: *mut gio::ffi::GAsyncResult,
                user_data: glib::ffi::gpointer,
            ) {
                let mut error = ptr::null_mut();
                let ret =
                    ffi::secret_collection_search_finish(_source_object as *mut _, res, &mut error);
                let result = if error.is_null() {
                    Ok(FromGlibPtrContainer::from_glib_full(ret))
                } else {
                    Err(from_glib_full(error))
                };
                let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
                    Box_::from_raw(user_data as *mut _);
                let callback: P = callback.into_inner();
                callback(result);
            }
            let callback = search_trampoline::<P>;

            ffi::secret_collection_search(
                self.as_ref().to_glib_none().0,
                schema.to_glib_none().0,
                attribute_names_and_values(attributes),
                flags.into_glib(),
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    fn search_future(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        flags: SearchFlags,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<Vec<Item>, glib::Error>> + 'static>> {
        let schema = schema.map(ToOwned::to_owned);
        let owned_map = attributes
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect::<HashMap<String, String>>();

        Box_::pin(gio::GioFuture::new(self, move |obj, cancellable, send| {
            let attributes = owned_map
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect::<HashMap<&str, &str>>();

            obj.search(
                schema.as_ref().map(::std::borrow::Borrow::borrow),
                attributes,
                flags,
                Some(cancellable),
                move |res| {
                    send.resolve(res);
                },
            );
        }))
    }

    fn search_sync(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        flags: SearchFlags,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
    ) -> Result<Vec<Item>, glib::Error> {
        unsafe {
            let mut err = std::ptr::null_mut();
            let res = ffi::secret_collection_search_sync(
                self.as_ref().to_glib_none().0,
                schema.to_glib_none().0,
                attribute_names_and_values(attributes),
                flags.into_glib(),
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                &mut err,
            );
            if err.is_null() {
                Ok(FromGlibPtrContainer::from_glib_full(res))
            } else {
                Err(from_glib_full(err))
            }
        }
    }
    #[doc(alias = "secret_collection_search_for_dbus_paths_sync")]
    fn search_for_dbus_paths_sync(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
    ) -> Result<Vec<glib::GString>, glib::Error> {
        unsafe {
            let mut err = std::ptr::null_mut();
            let res = ffi::secret_collection_search_for_dbus_paths_sync(
                self.as_ref().to_glib_none().0,
                schema.to_glib_none().0,
                attribute_names_and_values(attributes),
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                &mut err,
            );
            if err.is_null() {
                Ok(FromGlibPtrContainer::from_glib_full(res))
            } else {
                Err(from_glib_full(err))
            }
        }
    }

    #[doc(alias = "secret_collection_search_for_dbus_paths")]
    fn search_for_dbus_paths<P: FnOnce(Result<Vec<glib::GString>, glib::Error>) + 'static>(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        unsafe {
            let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::new(glib::thread_guard::ThreadGuard::new(callback));
            unsafe extern "C" fn search_trampoline<
                P: FnOnce(Result<Vec<glib::GString>, glib::Error>) + 'static,
            >(
                _source_object: *mut glib::gobject_ffi::GObject,
                res: *mut gio::ffi::GAsyncResult,
                user_data: glib::ffi::gpointer,
            ) {
                let mut error = ptr::null_mut();
                let ret = ffi::secret_collection_search_for_dbus_paths_finish(
                    _source_object as *mut _,
                    res,
                    &mut error,
                );
                let result = if error.is_null() {
                    Ok(FromGlibPtrContainer::from_glib_full(ret))
                } else {
                    Err(from_glib_full(error))
                };
                let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
                    Box_::from_raw(user_data as *mut _);
                let callback: P = callback.into_inner();
                callback(result);
            }
            let callback = search_trampoline::<P>;

            ffi::secret_collection_search_for_dbus_paths(
                self.as_ref().to_glib_none().0,
                schema.to_glib_none().0,
                attribute_names_and_values(attributes),
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    fn search_for_dbus_paths_future(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
    ) -> Pin<
        Box_<dyn std::future::Future<Output = Result<Vec<glib::GString>, glib::Error>> + 'static>,
    > {
        let schema = schema.map(ToOwned::to_owned);
        let owned_map = attributes
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect::<HashMap<String, String>>();

        Box_::pin(gio::GioFuture::new(self, move |obj, cancellable, send| {
            let attributes = owned_map
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect::<HashMap<&str, &str>>();

            obj.search_for_dbus_paths(
                schema.as_ref().map(::std::borrow::Borrow::borrow),
                attributes,
                Some(cancellable),
                move |res| {
                    send.resolve(res);
                },
            );
        }))
    }
}
