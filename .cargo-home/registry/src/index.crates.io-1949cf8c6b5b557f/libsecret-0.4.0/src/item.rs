// Take a look at the license at the top of the repository in the LICENSE file.

use crate::{hashtable::attribute_names_and_values, Item};
use crate::{Collection, ItemCreateFlags, Schema, Value};

use glib::translate::*;
use glib::IsA;

use std::boxed::Box as Box_;
use std::collections::HashMap;
use std::pin::Pin;
use std::ptr;

impl Item {
    #[doc(alias = "secret_item_create_sync")]
    pub fn create_sync(
        collection: &impl IsA<Collection>,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        label: &str,
        value: &Value,
        flags: ItemCreateFlags,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
    ) -> Result<Self, glib::Error> {
        unsafe {
            let mut err = std::ptr::null_mut();
            let item = ffi::secret_item_create_sync(
                collection.as_ref().to_glib_none().0,
                schema.to_glib_none().0,
                attribute_names_and_values(attributes),
                label.to_glib_none().0,
                value.to_glib_none().0,
                flags.into_glib(),
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                &mut err,
            );
            if err.is_null() {
                Ok(from_glib_full(item))
            } else {
                Err(from_glib_full(err))
            }
        }
    }

    #[doc(alias = "secret_item_load_secrets_sync")]
    pub fn load_secrets_sync(
        items: &[Item],
        cancellable: Option<&impl glib::IsA<gio::Cancellable>>,
    ) -> Result<(), glib::Error> {
        unsafe {
            let mut error = ptr::null_mut();
            let is_ok = ffi::secret_item_load_secrets_sync(
                items.to_glib_none().0,
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                &mut error,
            );
            assert_eq!(is_ok == glib::ffi::GFALSE, !error.is_null());
            if error.is_null() {
                Ok(())
            } else {
                Err(from_glib_full(error))
            }
        }
    }

    #[doc(alias = "secret_item_load_secrets")]
    pub fn load_secrets<P: FnOnce(Result<(), glib::Error>) + 'static>(
        items: &[Item],
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
        unsafe extern "C" fn load_secrets_trampoline<
            P: FnOnce(Result<(), glib::Error>) + 'static,
        >(
            _source_object: *mut glib::gobject_ffi::GObject,
            res: *mut gio::ffi::GAsyncResult,
            user_data: glib::ffi::gpointer,
        ) {
            let mut error = ptr::null_mut();
            let _ = ffi::secret_item_load_secrets_finish(res, &mut error);
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
        let callback = load_secrets_trampoline::<P>;
        unsafe {
            ffi::secret_item_load_secrets(
                items.to_glib_none().0,
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    pub fn load_secrets_future(
        items: &[Item],
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<(), glib::Error>> + 'static>> {
        let items = items.to_vec();
        Box_::pin(gio::GioFuture::new(&(), move |_obj, cancellable, send| {
            Self::load_secrets(&items, Some(cancellable), move |res| {
                send.resolve(res);
            });
        }))
    }

    #[doc(alias = "secret_item_create")]
    pub fn create<P: FnOnce(Result<Item, glib::Error>) + 'static>(
        collection: &impl IsA<Collection>,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        label: &str,
        value: &Value,
        flags: ItemCreateFlags,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        unsafe {
            let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::new(glib::thread_guard::ThreadGuard::new(callback));
            unsafe extern "C" fn create_trampoline<
                P: FnOnce(Result<Item, glib::Error>) + 'static,
            >(
                _source_object: *mut glib::gobject_ffi::GObject,
                res: *mut gio::ffi::GAsyncResult,
                user_data: glib::ffi::gpointer,
            ) {
                let mut error = ptr::null_mut();
                let ret = ffi::secret_item_create_finish(res, &mut error);
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
            let callback = create_trampoline::<P>;

            ffi::secret_item_create(
                collection.as_ref().to_glib_none().0,
                schema.to_glib_none().0,
                attribute_names_and_values(attributes),
                label.to_glib_none().0,
                value.to_glib_none().0,
                flags.into_glib(),
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    pub fn create_future(
        collection: &(impl IsA<Collection> + Clone + 'static),
        schema: Option<&Schema>,
        attributes: HashMap<String, &str>,
        label: &str,
        value: &Value,
        flags: ItemCreateFlags,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<Item, glib::Error>> + 'static>> {
        let collection = collection.clone();
        let schema = schema.map(ToOwned::to_owned);
        let label = String::from(label);
        let value = value.clone();
        let owned_map = attributes
            .into_iter()
            .map(|(k, v)| (k, v.to_string()))
            .collect::<HashMap<String, String>>();

        Box_::pin(gio::GioFuture::new(&(), move |_obj, cancellable, send| {
            let attributes = owned_map
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect::<HashMap<&str, &str>>();
            Self::create(
                &collection,
                schema.as_ref().map(::std::borrow::Borrow::borrow),
                attributes,
                &label,
                &value,
                flags,
                Some(cancellable),
                move |res| {
                    send.resolve(res);
                },
            );
        }))
    }

    #[doc(alias = "secret_item_set_attributes")]
    pub fn set_attributes<P: FnOnce(Result<(), glib::Error>) + 'static>(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    ) {
        unsafe {
            let user_data: Box_<glib::thread_guard::ThreadGuard<P>> =
                Box_::new(glib::thread_guard::ThreadGuard::new(callback));
            unsafe extern "C" fn set_attributes_trampoline<
                P: FnOnce(Result<(), glib::Error>) + 'static,
            >(
                source_object: *mut glib::gobject_ffi::GObject,
                res: *mut gio::ffi::GAsyncResult,
                user_data: glib::ffi::gpointer,
            ) {
                let mut err = ptr::null_mut();
                let _ =
                    ffi::secret_item_set_attributes_finish(source_object as *mut _, res, &mut err);
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
            let callback = set_attributes_trampoline::<P>;

            ffi::secret_item_set_attributes(
                self.to_glib_none().0,
                schema.to_glib_none().0,
                attribute_names_and_values(attributes),
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    pub fn set_attributes_future(
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
            obj.set_attributes(
                schema.as_ref().map(::std::borrow::Borrow::borrow),
                attributes,
                Some(cancellable),
                move |res| {
                    send.resolve(res);
                },
            );
        }))
    }

    #[doc(alias = "secret_item_set_attributes_sync")]
    pub fn set_attributes_sync(
        &self,
        schema: Option<&Schema>,
        attributes: HashMap<&str, &str>,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
    ) -> Result<(), glib::Error> {
        unsafe {
            let mut err = std::ptr::null_mut();
            ffi::secret_item_set_attributes_sync(
                self.to_glib_none().0,
                schema.to_glib_none().0,
                attribute_names_and_values(attributes),
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                &mut err,
            );
            if err.is_null() {
                Ok(())
            } else {
                Err(from_glib_full(err))
            }
        }
    }
}
