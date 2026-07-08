// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Prompt;

use glib::translate::*;
use glib::IsA;

use std::boxed::Box as Box_;
use std::pin::Pin;
use std::ptr;

pub trait PromptExtManual: 'static {
    #[doc(alias = "secret_prompt_perform")]
    fn perform<P: FnOnce(Result<glib::Variant, glib::Error>) + 'static>(
        &self,
        window_id: Option<&str>,
        return_type: &glib::VariantTy,
        cancellable: Option<&impl IsA<gio::Cancellable>>,
        callback: P,
    );

    fn perform_future(
        &self,
        window_id: Option<&str>,
        return_type: &glib::VariantTy,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<glib::Variant, glib::Error>> + 'static>>;
}

impl<O: IsA<Prompt>> PromptExtManual for O {
    fn perform<P: FnOnce(Result<glib::Variant, glib::Error>) + 'static>(
        &self,
        window_id: Option<&str>,
        return_type: &glib::VariantTy,
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
        unsafe extern "C" fn perform_trampoline<
            P: FnOnce(Result<glib::Variant, glib::Error>) + 'static,
        >(
            _source_object: *mut glib::gobject_ffi::GObject,
            res: *mut gio::ffi::GAsyncResult,
            user_data: glib::ffi::gpointer,
        ) {
            let mut error = ptr::null_mut();
            let ret = ffi::secret_prompt_perform_finish(_source_object as *mut _, res, &mut error);
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
        let callback = perform_trampoline::<P>;
        unsafe {
            ffi::secret_prompt_perform(
                self.as_ref().to_glib_none().0,
                window_id.to_glib_none().0,
                return_type.to_glib_none().0,
                cancellable.map(|p| p.as_ref()).to_glib_none().0,
                Some(callback),
                Box_::into_raw(user_data) as *mut _,
            );
        }
    }

    fn perform_future(
        &self,
        window_id: Option<&str>,
        return_type: &glib::VariantTy,
    ) -> Pin<Box_<dyn std::future::Future<Output = Result<glib::Variant, glib::Error>> + 'static>>
    {
        let window_id = window_id.map(ToOwned::to_owned);
        let return_type = return_type.to_owned();
        Box_::pin(gio::GioFuture::new(self, move |obj, cancellable, send| {
            obj.perform(
                window_id.as_ref().map(::std::borrow::Borrow::borrow),
                &return_type,
                Some(cancellable),
                move |res| {
                    send.resolve(res);
                },
            );
        }))
    }
}
