#[cfg(any(feature = "v2_16", docsrs))]
#[cfg_attr(docsrs, doc(cfg(feature = "v2_16")))]
use crate::WebsiteData;
use crate::WebsiteDataManager;
#[cfg(any(feature = "v2_16", docsrs))]
#[cfg_attr(docsrs, doc(cfg(feature = "v2_16")))]
use crate::WebsiteDataTypes;
use glib::{object::IsA, translate::*};
#[cfg(any(feature = "v2_16", docsrs))]
#[cfg_attr(docsrs, doc(cfg(feature = "v2_16")))]
use std::boxed::Box as Box_;
use std::ptr;

pub trait WebsiteDataManagerExtManual: 'static {
  #[cfg(any(feature = "v2_16", docsrs))]
  #[cfg_attr(docsrs, doc(cfg(feature = "v2_16")))]
  #[doc(alias = "webkit_website_data_manager_clear")]
  fn clear<P: FnOnce(Result<(), glib::Error>) + Send + 'static>(
    &self,
    types: WebsiteDataTypes,
    timespan: glib::TimeSpan,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
    callback: P,
  );

  #[cfg(any(feature = "v2_16", docsrs))]
  #[cfg_attr(docsrs, doc(cfg(feature = "v2_16")))]
  #[doc(alias = "webkit_website_data_manager_remove")]
  fn remove<P: FnOnce(Result<(), glib::Error>) + Send + 'static>(
    &self,
    types: WebsiteDataTypes,
    website_data: &[&WebsiteData],
    cancellable: Option<&impl IsA<gio::Cancellable>>,
    callback: P,
  );
}

impl<O: IsA<WebsiteDataManager>> WebsiteDataManagerExtManual for O {
  #[cfg(any(feature = "v2_16", docsrs))]
  #[cfg_attr(docsrs, doc(cfg(feature = "v2_16")))]
  fn clear<P: FnOnce(Result<(), glib::Error>) + Send + 'static>(
    &self,
    types: WebsiteDataTypes,
    timespan: glib::TimeSpan,
    cancellable: Option<&impl IsA<gio::Cancellable>>,
    callback: P,
  ) {
    let user_data: Box_<P> = Box_::new(callback);
    unsafe extern "C" fn clear_trampoline<P: FnOnce(Result<(), glib::Error>) + Send + 'static>(
      _source_object: *mut glib::gobject_ffi::GObject,
      res: *mut gio::ffi::GAsyncResult,
      user_data: glib::ffi::gpointer,
    ) {
      let mut error = ptr::null_mut();
      let _ =
        ffi::webkit_website_data_manager_clear_finish(_source_object as *mut _, res, &mut error);
      let result = if error.is_null() {
        Ok(())
      } else {
        Err(from_glib_full(error))
      };
      let callback: Box_<P> = Box_::from_raw(user_data as *mut _);
      callback(result);
    }
    let callback = clear_trampoline::<P>;
    unsafe {
      ffi::webkit_website_data_manager_clear(
        self.as_ref().to_glib_none().0,
        types.into_glib(),
        timespan.0,
        cancellable.map(|p| p.as_ref()).to_glib_none().0,
        Some(callback),
        Box_::into_raw(user_data) as *mut _,
      );
    }
  }

  #[cfg(any(feature = "v2_16", docsrs))]
  #[cfg_attr(docsrs, doc(cfg(feature = "v2_16")))]
  fn remove<P: FnOnce(Result<(), glib::Error>) + Send + 'static>(
    &self,
    types: WebsiteDataTypes,
    website_data: &[&WebsiteData],
    cancellable: Option<&impl IsA<gio::Cancellable>>,
    callback: P,
  ) {
    let user_data: Box_<P> = Box_::new(callback);
    unsafe extern "C" fn remove_trampoline<P: FnOnce(Result<(), glib::Error>) + Send + 'static>(
      _source_object: *mut glib::gobject_ffi::GObject,
      res: *mut gio::ffi::GAsyncResult,
      user_data: glib::ffi::gpointer,
    ) {
      let mut error = ptr::null_mut();
      let _ =
        ffi::webkit_website_data_manager_remove_finish(_source_object as *mut _, res, &mut error);
      let result = if error.is_null() {
        Ok(())
      } else {
        Err(from_glib_full(error))
      };
      let callback: Box_<P> = Box_::from_raw(user_data as *mut _);
      callback(result);
    }
    let callback = remove_trampoline::<P>;
    unsafe {
      ffi::webkit_website_data_manager_remove(
        self.as_ref().to_glib_none().0,
        types.into_glib(),
        website_data.to_glib_none().0,
        cancellable.map(|p| p.as_ref()).to_glib_none().0,
        Some(callback),
        Box_::into_raw(user_data) as *mut _,
      );
    }
  }
}
