// Take a look at the license at the top of the repository in the LICENSE file.

use crate::{
    hashtable::{attribute_names_and_properties, attribute_names_and_values},
    Service,
};
use crate::{CollectionCreateFlags, Item, ItemCreateFlags, Schema, SearchFlags, Value};

use glib::translate::*;
use glib::IsA;

use std::boxed::Box as Box_;
use std::collections::HashMap;
use std::pin::Pin;
use std::ptr;

pub trait ServiceExtManual: 'static {
    #[doc(alias = "secret_service_lock")]
    fn lock<P: FnOnce(Result<Vec<gio::DBusProxy>, glib::Error>) + 'static>(
        &self,
        objects: &[gio::DBusProxy],
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    );

    fn lock_future(
        &self,
        objects: &[gio::DBusProxy],
    ) -> Pin<
        Box_<dyn std::future::Future<Output = Result<Vec<gio::DBusProxy>, glib::Error>> + 'static>,
    >;

    #[doc(alias = "secret_service_lock_dbus_paths")]
    fn lock_dbus_paths<P: FnOnce(Result<Vec<glib::GString>, glib::Error>) + 'static>(
        &self,
        paths: &[&str],
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    );

    fn lock_dbus_paths_future(
        &self,
        paths: &[&str],
    ) -> Pin<
        Box_<dyn std::future::Future<Output = Result<Vec<glib::GString>, glib::Error>> + 'static>,
    >;

    #[doc(alias = "secret_service_lock_dbus_paths_sync")]
    fn lock_dbus_paths_sync(
        &self,
        paths: Vec<&str>,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
    ) -> Result<Vec<glib::GString>, glib::Error>;

    #[doc(alias = "secret_service_unlock")]
    fn unlock<P: FnOnce(Result<Vec<gio::DBusProxy>, glib::Error>) + 'static>(
        &self,
        objects: &[gio::DBusProxy],
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    );

    fn unlock_future(
        &self,
        objects: &[gio::DBusProxy],
    ) -> Pin<
        Box_<dyn std::future::Future<Output = Result<Vec<gio::DBusProxy>, glib::Error>> + 'static>,
    >;

    #[doc(alias = "secret_service_unlock_dbus_paths")]
    fn unlock_dbus_paths<P: FnOnce(Result<Vec<glib::GString>, glib::Error>) + 'static>(
        &self,
        paths: &[&str],
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    );

    fn unlock_dbus_paths_future(
        &self,
        paths: &[&str],
    ) -> Pin<
        Box_<dyn std::future::Future<Output = Result<Vec<glib::GString>, glib::Error>> + 'static>,
    >;

    #[doc(alias = "secret_service_store")]
    fn store<P: FnOnce(Result<(), glib::Error>) + 'static>(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        collection: Option<&str>,
        label: &str,
        value: &Value,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    );

    fn store_future(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        collection: Option<&str>,
        label: &str,
        value: &Value,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<(), glib::Error>> + 'static>>;

    #[doc(alias = "secret_service_search")]
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

    #[doc(alias = "secret_service_lookup")]
    fn lookup<P: FnOnce(Result<Value, glib::Error>) + 'static>(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    );

    fn lookup_future(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<Value, glib::Error>> + 'static>>;

    #[doc(alias = "secret_service_clear")]
    fn clear<P: FnOnce(Result<(), glib::Error>) + 'static>(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    );

    fn clear_future(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<(), glib::Error>> + 'static>>;

    #[doc(alias = "secret_service_create_item_dbus_path")]
    fn create_item_dbus_path<P: FnOnce(Result<glib::GString, glib::Error>) + 'static>(
        &self,
        collection_path: &str,
        properties: HashMap<&str, &glib::Variant>,
        value: &Value,
        flags: ItemCreateFlags,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    );

    fn create_item_dbus_path_future(
        &self,
        collection_path: &str,
        properties: HashMap<&str, &glib::Variant>,
        value: &Value,
        flags: ItemCreateFlags,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<glib::GString, glib::Error>> + 'static>>;

    #[doc(alias = "secret_service_create_collection_dbus_path")]
    fn create_collection_dbus_path<P: FnOnce(Result<glib::GString, glib::Error>) + 'static>(
        &self,
        properties: HashMap<&str, &glib::Variant>,
        alias: Option<&str>,
        flags: CollectionCreateFlags,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    );

    fn create_collection_dbus_path_future(
        &self,
        properties: HashMap<&str, &glib::Variant>,
        alias: Option<&str>,
        flags: CollectionCreateFlags,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<glib::GString, glib::Error>> + 'static>>;

    #[doc(alias = "secret_service_get_secrets_for_dbus_paths")]
    #[doc(alias = "get_secrets_for_dbus_paths")]
    fn secrets_for_dbus_paths<P: FnOnce(Result<HashMap<String, Value>, glib::Error>) + 'static>(
        &self,
        item_paths: &str,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    );

    fn secrets_for_dbus_paths_future(
        &self,
        item_paths: &str,
    ) -> Pin<
        Box_<
            dyn std::future::Future<Output = Result<HashMap<String, Value>, glib::Error>> + 'static,
        >,
    >;

    #[doc(alias = "secret_service_search_for_dbus_paths")]
    fn search_for_dbus_paths<
        P: FnOnce(Result<(Vec<glib::GString>, Vec<glib::GString>), glib::Error>) + 'static,
    >(
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
        Box_<
            dyn std::future::Future<
                    Output = Result<(Vec<glib::GString>, Vec<glib::GString>), glib::Error>,
                > + 'static,
        >,
    >;
}

impl<O: IsA<Service>> ServiceExtManual for O {
    #[doc(alias = "secret_lock_dbus_paths_sync")]
    fn lock_dbus_paths_sync(
        &self,
        paths: Vec<&str>,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
    ) -> Result<Vec<glib::GString>, glib::Error> {
        unsafe {
            let mut locked = ptr::null_mut();
            let mut error = ptr::null_mut();
            let _ = ffi::secret_service_lock_dbus_paths_sync(
                self.as_ref().to_glib_none().0,
                paths.to_glib_none().0,
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                &mut locked,
                &mut error,
            );
            if error.is_null() {
                Ok(FromGlibPtrContainer::from_glib_full(locked))
            } else {
                Err(from_glib_full(error))
            }
        }
    }

    fn unlock_dbus_paths<P: FnOnce(Result<Vec<glib::GString>, glib::Error>) + 'static>(
        &self,
        paths: &[&str],
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        let main_context = glib::MainContext::ref_thread_default();
        let is_main_context_owner = main_context.is_owner();
        let has_acquired_main_context = (!is_main_context_owner)
            .then(|| main_context.acquire().ok())
            .flatten();
        assert!(
            is_main_context_owner || has_acquired_main_context.is_some(),
            "Async operations only allowed if the thread is owning the MainContext"
        );

        let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
            Box_::new(glib::thread_guard::ThreadGuard::new(callback));
        unsafe extern "C" fn unlock_dbus_paths_trampoline<
            P: FnOnce(Result<Vec<glib::GString>, glib::Error>) + 'static,
        >(
            _source_object: *mut glib::gobject_ffi::GObject,
            res: *mut gio::ffi::GAsyncResult,
            user_data: glib::ffi::gpointer,
        ) {
            let mut error = ptr::null_mut();
            let mut unlocked = ptr::null_mut();
            let _ = ffi::secret_service_unlock_dbus_paths_finish(
                _source_object as *mut _,
                res,
                &mut unlocked,
                &mut error,
            );
            let result = if error.is_null() {
                Ok(FromGlibPtrContainer::from_glib_full(unlocked))
            } else {
                Err(from_glib_full(error))
            };
            let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::from_raw(user_data as *mut _);
            let callback: P = callback.into_inner();
            callback(result);
        }
        let callback = unlock_dbus_paths_trampoline::<P>;

        unsafe {
            ffi::secret_service_unlock_dbus_paths(
                self.as_ref().to_glib_none().0,
                paths.to_glib_none().0,
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    fn unlock_dbus_paths_future(
        &self,
        paths: &[&str],
    ) -> Pin<
        Box_<dyn std::future::Future<Output = Result<Vec<glib::GString>, glib::Error>> + 'static>,
    > {
        let paths = paths.iter().copied().map(String::from).collect::<Vec<_>>();
        Box_::pin(gio::GioFuture::new(self, move |obj, cancellable, send| {
            let paths = paths.iter().map(|s| s.as_str()).collect::<Vec<_>>();
            obj.unlock_dbus_paths(&paths, Some(cancellable), move |res| {
                send.resolve(res);
            });
        }))
    }

    fn unlock<P: FnOnce(Result<Vec<gio::DBusProxy>, glib::Error>) + 'static>(
        &self,
        objects: &[gio::DBusProxy],
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        let main_context = glib::MainContext::ref_thread_default();
        let is_main_context_owner = main_context.is_owner();
        let has_acquired_main_context = (!is_main_context_owner)
            .then(|| main_context.acquire().ok())
            .flatten();
        assert!(
            is_main_context_owner || has_acquired_main_context.is_some(),
            "Async operations only allowed if the thread is owning the MainContext"
        );

        let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
            Box_::new(glib::thread_guard::ThreadGuard::new(callback));
        unsafe extern "C" fn unlock_trampoline<
            P: FnOnce(Result<Vec<gio::DBusProxy>, glib::Error>) + 'static,
        >(
            _source_object: *mut glib::gobject_ffi::GObject,
            res: *mut gio::ffi::GAsyncResult,
            user_data: glib::ffi::gpointer,
        ) {
            let mut error = ptr::null_mut();
            let mut unlocked = ptr::null_mut();
            let _ = ffi::secret_service_unlock_finish(
                _source_object as *mut _,
                res,
                &mut unlocked,
                &mut error,
            );
            let result = if error.is_null() {
                Ok(FromGlibPtrContainer::from_glib_full(unlocked))
            } else {
                Err(from_glib_full(error))
            };
            let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::from_raw(user_data as *mut _);
            let callback: P = callback.into_inner();
            callback(result);
        }
        let callback = unlock_trampoline::<P>;
        unsafe {
            ffi::secret_service_unlock(
                self.as_ref().to_glib_none().0,
                objects.to_glib_none().0,
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    fn unlock_future(
        &self,
        objects: &[gio::DBusProxy],
    ) -> Pin<
        Box_<dyn std::future::Future<Output = Result<Vec<gio::DBusProxy>, glib::Error>> + 'static>,
    > {
        let objects = objects.to_vec();
        Box_::pin(gio::GioFuture::new(self, move |obj, cancellable, send| {
            obj.unlock(&objects, Some(cancellable), move |res| {
                send.resolve(res);
            });
        }))
    }

    fn lock_dbus_paths<P: FnOnce(Result<Vec<glib::GString>, glib::Error>) + 'static>(
        &self,
        paths: &[&str],
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        let main_context = glib::MainContext::ref_thread_default();
        let is_main_context_owner = main_context.is_owner();
        let has_acquired_main_context = (!is_main_context_owner)
            .then(|| main_context.acquire().ok())
            .flatten();
        assert!(
            is_main_context_owner || has_acquired_main_context.is_some(),
            "Async operations only allowed if the thread is owning the MainContext"
        );

        let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
            Box_::new(glib::thread_guard::ThreadGuard::new(callback));
        unsafe extern "C" fn lock_dbus_paths_trampoline<
            P: FnOnce(Result<Vec<glib::GString>, glib::Error>) + 'static,
        >(
            _source_object: *mut glib::gobject_ffi::GObject,
            res: *mut gio::ffi::GAsyncResult,
            user_data: glib::ffi::gpointer,
        ) {
            let mut error = ptr::null_mut();
            let mut locked = ptr::null_mut();
            let _ = ffi::secret_service_lock_dbus_paths_finish(
                _source_object as *mut _,
                res,
                &mut locked,
                &mut error,
            );
            let result = if error.is_null() {
                Ok(FromGlibPtrContainer::from_glib_full(locked))
            } else {
                Err(from_glib_full(error))
            };
            let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::from_raw(user_data as *mut _);
            let callback: P = callback.into_inner();
            callback(result);
        }
        let callback = lock_dbus_paths_trampoline::<P>;
        unsafe {
            ffi::secret_service_lock_dbus_paths(
                self.as_ref().to_glib_none().0,
                paths.to_glib_none().0,
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    fn lock_dbus_paths_future(
        &self,
        paths: &[&str],
    ) -> Pin<
        Box_<dyn std::future::Future<Output = Result<Vec<glib::GString>, glib::Error>> + 'static>,
    > {
        let paths = paths.iter().copied().map(String::from).collect::<Vec<_>>();
        Box_::pin(gio::GioFuture::new(self, move |obj, cancellable, send| {
            let paths = paths.iter().map(|s| s.as_str()).collect::<Vec<_>>();
            obj.lock_dbus_paths(&paths, Some(cancellable), move |res| {
                send.resolve(res);
            });
        }))
    }

    fn lock<P: FnOnce(Result<Vec<gio::DBusProxy>, glib::Error>) + 'static>(
        &self,
        objects: &[gio::DBusProxy],
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        let main_context = glib::MainContext::ref_thread_default();
        let is_main_context_owner = main_context.is_owner();
        let has_acquired_main_context = (!is_main_context_owner)
            .then(|| main_context.acquire().ok())
            .flatten();
        assert!(
            is_main_context_owner || has_acquired_main_context.is_some(),
            "Async operations only allowed if the thread is owning the MainContext"
        );

        let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
            Box_::new(glib::thread_guard::ThreadGuard::new(callback));
        unsafe extern "C" fn lock_trampoline<
            P: FnOnce(Result<Vec<gio::DBusProxy>, glib::Error>) + 'static,
        >(
            _source_object: *mut glib::gobject_ffi::GObject,
            res: *mut gio::ffi::GAsyncResult,
            user_data: glib::ffi::gpointer,
        ) {
            let mut error = ptr::null_mut();
            let mut locked = ptr::null_mut();
            let _ = ffi::secret_service_lock_finish(
                _source_object as *mut _,
                res,
                &mut locked,
                &mut error,
            );
            let result = if error.is_null() {
                Ok(FromGlibPtrContainer::from_glib_full(locked))
            } else {
                Err(from_glib_full(error))
            };
            let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::from_raw(user_data as *mut _);
            let callback: P = callback.into_inner();
            callback(result);
        }
        let callback = lock_trampoline::<P>;
        unsafe {
            ffi::secret_service_lock(
                self.as_ref().to_glib_none().0,
                objects.to_glib_none().0,
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    fn lock_future(
        &self,
        objects: &[gio::DBusProxy],
    ) -> Pin<
        Box_<dyn std::future::Future<Output = Result<Vec<gio::DBusProxy>, glib::Error>> + 'static>,
    > {
        let objects = objects.to_vec();
        Box_::pin(gio::GioFuture::new(self, move |obj, cancellable, send| {
            obj.lock(&objects, Some(cancellable), move |res| {
                send.resolve(res);
            });
        }))
    }

    fn store<P: FnOnce(Result<(), glib::Error>) + 'static>(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        collection: Option<&str>,
        label: &str,
        value: &Value,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        unsafe {
            let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::new(glib::thread_guard::ThreadGuard::new(callback));
            unsafe extern "C" fn store_trampoline<P: FnOnce(Result<(), glib::Error>) + 'static>(
                source_object: *mut glib::gobject_ffi::GObject,
                res: *mut gio::ffi::GAsyncResult,
                user_data: glib::ffi::gpointer,
            ) {
                let mut error = ptr::null_mut();
                let _ = ffi::secret_service_store_finish(source_object as *mut _, res, &mut error);
                let result = if error.is_null() {
                    Ok(())
                } else {
                    Err(from_glib_full(error))
                };
                let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
                    Box_::from_raw(user_data as *mut _);
                let callback: P = callback.into_inner();
                callback(result);
            }
            let callback = store_trampoline::<P>;

            ffi::secret_service_store(
                self.as_ref().to_glib_none().0,
                schema.to_glib_none().0,
                attribute_names_and_values(attributes),
                collection.to_glib_none().0,
                label.to_glib_none().0,
                value.to_glib_none().0,
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    fn store_future(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        collection: Option<&str>,
        label: &str,
        value: &Value,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<(), glib::Error>> + 'static>> {
        let schema = schema.map(ToOwned::to_owned);
        let collection = collection.map(ToOwned::to_owned);
        let label = String::from(label);
        let value = value.clone();
        let owned_map = attributes
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect::<HashMap<String, String>>();

        Box_::pin(gio::GioFuture::new(self, move |obj, cancellable, send| {
            let attributes = owned_map
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect::<HashMap<&str, &str>>();
            obj.store(
                schema.as_ref().map(::std::borrow::Borrow::borrow),
                attributes,
                collection.as_ref().map(::std::borrow::Borrow::borrow),
                &label,
                &value,
                Some(cancellable),
                move |res| {
                    send.resolve(res);
                },
            );
        }))
    }

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
                    ffi::secret_service_search_finish(_source_object as *mut _, res, &mut error);
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

            ffi::secret_service_search(
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

    fn lookup<P: FnOnce(Result<Value, glib::Error>) + 'static>(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        unsafe {
            let hash_table = attribute_names_and_values(attributes);

            let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::new(glib::thread_guard::ThreadGuard::new(callback));
            unsafe extern "C" fn lookup_trampoline<
                P: FnOnce(Result<Value, glib::Error>) + 'static,
            >(
                _source_object: *mut glib::gobject_ffi::GObject,
                res: *mut gio::ffi::GAsyncResult,
                user_data: glib::ffi::gpointer,
            ) {
                let mut error = ptr::null_mut();
                let ret =
                    ffi::secret_service_lookup_finish(_source_object as *mut _, res, &mut error);
                let result = if error.is_null() {
                    Ok(from_glib_full(ret))
                } else {
                    Err(from_glib_full(error))
                };
                let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
                    Box_::from_raw(user_data as *mut _);
                let callback: P = callback.into_inner();
                callback(result);
            }
            let callback = lookup_trampoline::<P>;

            ffi::secret_service_lookup(
                self.as_ref().to_glib_none().0,
                schema.to_glib_none().0,
                hash_table,
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    fn lookup_future(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<Value, glib::Error>> + 'static>> {
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

            obj.lookup(
                schema.as_ref().map(::std::borrow::Borrow::borrow),
                attributes,
                Some(cancellable),
                move |res| {
                    send.resolve(res);
                },
            );
        }))
    }

    fn clear<P: FnOnce(Result<(), glib::Error>) + 'static>(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        unsafe {
            let hash_table = attribute_names_and_values(attributes);

            let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::new(glib::thread_guard::ThreadGuard::new(callback));
            unsafe extern "C" fn clear_trampoline<P: FnOnce(Result<(), glib::Error>) + 'static>(
                _source_object: *mut glib::gobject_ffi::GObject,
                res: *mut gio::ffi::GAsyncResult,
                user_data: glib::ffi::gpointer,
            ) {
                let mut error = ptr::null_mut();
                let _ = ffi::secret_service_clear_finish(_source_object as *mut _, res, &mut error);
                let result = if error.is_null() {
                    Ok(())
                } else {
                    Err(from_glib_full(error))
                };
                let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
                    Box_::from_raw(user_data as *mut _);
                let callback: P = callback.into_inner();
                callback(result);
            }
            let callback = clear_trampoline::<P>;

            ffi::secret_service_clear(
                self.as_ref().to_glib_none().0,
                schema.to_glib_none().0,
                hash_table,
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    fn clear_future(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<(), glib::Error>> + 'static>> {
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
            obj.clear(
                schema.as_ref().map(::std::borrow::Borrow::borrow),
                attributes,
                Some(cancellable),
                move |res| {
                    send.resolve(res);
                },
            );
        }))
    }

    fn create_item_dbus_path<P: FnOnce(Result<glib::GString, glib::Error>) + 'static>(
        &self,
        collection_path: &str,
        properties: HashMap<&str, &glib::Variant>,
        value: &Value,
        flags: ItemCreateFlags,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        unsafe {
            let hash_table = attribute_names_and_properties(properties);

            let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::new(glib::thread_guard::ThreadGuard::new(callback));
            unsafe extern "C" fn create_item_dbus_path_trampoline<
                P: FnOnce(Result<glib::GString, glib::Error>) + 'static,
            >(
                _source_object: *mut glib::gobject_ffi::GObject,
                res: *mut gio::ffi::GAsyncResult,
                user_data: glib::ffi::gpointer,
            ) {
                let mut error = ptr::null_mut();
                let ret = ffi::secret_service_create_item_dbus_path_finish(
                    _source_object as *mut _,
                    res,
                    &mut error,
                );
                let result = if error.is_null() {
                    Ok(from_glib_full(ret))
                } else {
                    Err(from_glib_full(error))
                };
                let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
                    Box_::from_raw(user_data as *mut _);
                let callback: P = callback.into_inner();
                callback(result);
            }
            let callback = create_item_dbus_path_trampoline::<P>;

            ffi::secret_service_create_item_dbus_path(
                self.as_ref().to_glib_none().0,
                collection_path.to_glib_none().0,
                hash_table,
                value.to_glib_none().0,
                flags.into_glib(),
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    fn create_item_dbus_path_future(
        &self,
        collection_path: &str,
        properties: HashMap<&str, &glib::Variant>,
        value: &Value,
        flags: ItemCreateFlags,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<glib::GString, glib::Error>> + 'static>>
    {
        let collection_path = String::from(collection_path);
        let value = value.clone();
        let owned_map = properties
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_owned()))
            .collect::<HashMap<String, glib::Variant>>();

        Box_::pin(gio::GioFuture::new(self, move |obj, cancellable, send| {
            let properties = owned_map
                .iter()
                .map(|(k, v)| (k.as_str(), v))
                .collect::<HashMap<&str, &glib::Variant>>();
            obj.create_item_dbus_path(
                &collection_path,
                properties,
                &value,
                flags,
                Some(cancellable),
                move |res| {
                    send.resolve(res);
                },
            );
        }))
    }

    fn create_collection_dbus_path<P: FnOnce(Result<glib::GString, glib::Error>) + 'static>(
        &self,
        properties: HashMap<&str, &glib::Variant>,
        alias: Option<&str>,
        flags: CollectionCreateFlags,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        unsafe {
            let hash_table = attribute_names_and_properties(properties);

            let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::new(glib::thread_guard::ThreadGuard::new(callback));
            unsafe extern "C" fn create_collection_dbus_path_trampoline<
                P: FnOnce(Result<glib::GString, glib::Error>) + 'static,
            >(
                _source_object: *mut glib::gobject_ffi::GObject,
                res: *mut gio::ffi::GAsyncResult,
                user_data: glib::ffi::gpointer,
            ) {
                let mut error = ptr::null_mut();
                let ret = ffi::secret_service_create_collection_dbus_path_finish(
                    _source_object as *mut _,
                    res,
                    &mut error,
                );
                let result = if error.is_null() {
                    Ok(from_glib_full(ret))
                } else {
                    Err(from_glib_full(error))
                };
                let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
                    Box_::from_raw(user_data as *mut _);
                let callback: P = callback.into_inner();
                callback(result);
            }
            let callback = create_collection_dbus_path_trampoline::<P>;

            ffi::secret_service_create_collection_dbus_path(
                self.as_ref().to_glib_none().0,
                hash_table,
                alias.to_glib_none().0,
                flags.into_glib(),
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    fn create_collection_dbus_path_future(
        &self,
        properties: HashMap<&str, &glib::Variant>,
        alias: Option<&str>,
        flags: CollectionCreateFlags,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<glib::GString, glib::Error>> + 'static>>
    {
        let alias = alias.map(ToOwned::to_owned);
        let owned_map = properties
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_owned()))
            .collect::<HashMap<String, glib::Variant>>();
        Box_::pin(gio::GioFuture::new(self, move |obj, cancellable, send| {
            let properties = owned_map
                .iter()
                .map(|(k, v)| (k.as_str(), v))
                .collect::<HashMap<&str, &glib::Variant>>();
            obj.create_collection_dbus_path(
                properties,
                alias.as_ref().map(::std::borrow::Borrow::borrow),
                flags,
                Some(cancellable),
                move |res| {
                    send.resolve(res);
                },
            );
        }))
    }

    fn secrets_for_dbus_paths<P: FnOnce(Result<HashMap<String, Value>, glib::Error>) + 'static>(
        &self,
        item_paths: &str,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        unsafe {
            let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::new(glib::thread_guard::ThreadGuard::new(callback));
            unsafe extern "C" fn secrets_for_dbus_paths_trampoline<
                P: FnOnce(Result<HashMap<String, Value>, glib::Error>) + 'static,
            >(
                _source_object: *mut glib::gobject_ffi::GObject,
                res: *mut gio::ffi::GAsyncResult,
                user_data: glib::ffi::gpointer,
            ) {
                let mut error = ptr::null_mut();
                let ret = ffi::secret_service_get_secrets_for_dbus_paths_finish(
                    _source_object as *mut _,
                    res,
                    &mut error,
                );

                let result = if error.is_null() {
                    Ok(crate::hashtable::hash_map_from_glib_none(ret))
                } else {
                    Err(from_glib_full(error))
                };
                let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
                    Box_::from_raw(user_data as *mut _);
                let callback: P = callback.into_inner();
                callback(result);
            }
            let callback = secrets_for_dbus_paths_trampoline::<P>;

            let mut item_paths = item_paths.to_string();
            ffi::secret_service_get_secrets_for_dbus_paths(
                self.as_ref().to_glib_none().0,
                &mut item_paths as *mut _ as *mut *const libc::c_char,
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    fn secrets_for_dbus_paths_future(
        &self,
        item_paths: &str,
    ) -> Pin<
        Box_<
            dyn std::future::Future<Output = Result<HashMap<String, Value>, glib::Error>> + 'static,
        >,
    > {
        let item_paths = String::from(item_paths);
        Box_::pin(gio::GioFuture::new(self, move |obj, cancellable, send| {
            obj.secrets_for_dbus_paths(&item_paths, Some(cancellable), move |res| {
                send.resolve(res);
            });
        }))
    }

    fn search_for_dbus_paths<
        P: FnOnce(Result<(Vec<glib::GString>, Vec<glib::GString>), glib::Error>) + 'static,
    >(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        unsafe {
            let hash_table = attribute_names_and_values(attributes);

            let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::new(glib::thread_guard::ThreadGuard::new(callback));
            unsafe extern "C" fn search_for_dbus_paths_trampoline<
                P: FnOnce(Result<(Vec<glib::GString>, Vec<glib::GString>), glib::Error>) + 'static,
            >(
                _source_object: *mut glib::gobject_ffi::GObject,
                res: *mut gio::ffi::GAsyncResult,
                user_data: glib::ffi::gpointer,
            ) {
                let mut error = ptr::null_mut();
                let mut unlocked = ptr::null_mut();
                let mut locked = ptr::null_mut();
                let _ = ffi::secret_service_search_for_dbus_paths_finish(
                    _source_object as *mut _,
                    res,
                    &mut unlocked,
                    &mut locked,
                    &mut error,
                );
                let result = if error.is_null() {
                    Ok((
                        FromGlibPtrContainer::from_glib_full(unlocked),
                        FromGlibPtrContainer::from_glib_full(locked),
                    ))
                } else {
                    Err(from_glib_full(error))
                };
                let callback: Box_<glib::thread_guard::ThreadGuard<P>> =
                    Box_::from_raw(user_data as *mut _);
                let callback: P = callback.into_inner();
                callback(result);
            }
            let callback = search_for_dbus_paths_trampoline::<P>;

            ffi::secret_service_search_for_dbus_paths(
                self.as_ref().to_glib_none().0,
                schema.to_glib_none().0,
                hash_table,
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
        Box_<
            dyn std::future::Future<
                    Output = Result<(Vec<glib::GString>, Vec<glib::GString>), glib::Error>,
                > + 'static,
        >,
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
