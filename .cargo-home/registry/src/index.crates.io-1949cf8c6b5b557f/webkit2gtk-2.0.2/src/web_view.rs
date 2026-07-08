// Take a look at the license at the top of the repository in the LICENSE file.

#[cfg(feature = "v2_6")]
use crate::UserContentManager;
#[cfg(feature = "v2_6")]
use crate::WebContext;
use crate::WebView;
use glib::IsA;

pub trait WebViewExtManual {
  #[cfg(feature = "v2_6")]
  fn new_with_context_and_user_content_manager(
    context: &WebContext,
    user_content_manager: &UserContentManager,
  ) -> Self;
}

impl<O> WebViewExtManual for O
where
  O: IsA<gtk::Widget> + IsA<WebView>,
{
  #[cfg(feature = "v2_6")]
  fn new_with_context_and_user_content_manager(
    context: &WebContext,
    user_content_manager: &UserContentManager,
  ) -> Self {
    use glib::{
      object::Cast,
      translate::{FromGlibPtrNone, IntoGlib, ToGlibPtr},
      StaticType,
    };
    use std::{ffi::CString, ptr};
    assert_initialized_main_thread!();
    let user_content_manager_property = CString::new("user-content-manager").unwrap();
    let web_context_property = CString::new("web-context").unwrap();
    let glib_user_content_manager: *mut ffi::WebKitUserContentManager =
      user_content_manager.to_glib_none().0;
    let glib_user_content_manager = glib_user_content_manager as *mut gobject_sys::GObject;
    let glib_context: *mut ffi::WebKitWebContext = context.to_glib_none().0;
    let glib_context = glib_context as *mut gobject_sys::GObject;
    let null: *mut gobject_sys::GObject = ptr::null_mut();
    unsafe {
      gtk::Widget::from_glib_none(gobject_sys::g_object_new(
        WebView::static_type().into_glib(),
        user_content_manager_property.as_ptr(),
        glib_user_content_manager,
        web_context_property.as_ptr(),
        glib_context,
        null,
      ) as *mut _)
      .downcast()
      .expect("downcast")
    }
  }
}
