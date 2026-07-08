use glib::translate::*;

glib::wrapper! {
    #[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
    pub struct JavascriptResult(Shared<ffi::WebKitJavascriptResult>);

    match fn {
        ref => |ptr| ffi::webkit_javascript_result_ref(ptr),
        unref => |ptr| ffi::webkit_javascript_result_unref(ptr),
        type_ => || ffi::webkit_javascript_result_get_type(),
    }
}

impl JavascriptResult {
  #[cfg_attr(feature = "v2_22", deprecated = "Since 2.22")]
  #[doc(alias = "webkit_javascript_result_get_global_context")]
  #[doc(alias = "get_global_context")]
  pub fn global_context(&self) -> Option<javascriptcore::GlobalContextRef> {
    unsafe {
      from_glib_none(ffi::webkit_javascript_result_get_global_context(
        self.to_glib_none().0,
      ))
    }
  }

  #[cfg(any(feature = "v2_22", docsrs))]
  #[cfg_attr(docsrs, doc(cfg(feature = "v2_22")))]
  #[doc(alias = "webkit_javascript_result_get_js_value")]
  #[doc(alias = "get_js_value")]
  pub fn js_value(&self) -> Option<javascriptcore::Value> {
    unsafe {
      from_glib_none(ffi::webkit_javascript_result_get_js_value(
        self.to_glib_none().0,
      ))
    }
  }

  #[cfg_attr(feature = "v2_22", deprecated = "Since 2.22")]
  #[doc(alias = "webkit_javascript_result_get_value")]
  #[doc(alias = "get_value")]
  pub fn value(&self) -> Option<javascriptcore::ValueRef> {
    unsafe {
      from_glib_none(ffi::webkit_javascript_result_get_value(
        self.to_glib_none().0,
      ))
    }
  }
}
