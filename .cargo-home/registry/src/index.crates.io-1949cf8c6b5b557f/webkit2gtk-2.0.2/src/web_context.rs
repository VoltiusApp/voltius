// Take a look at the license at the top of the repository in the LICENSE file.

#[cfg(feature = "v2_16")]
use super::{NetworkProxyMode, NetworkProxySettings};
#[cfg(feature = "v2_6")]
use glib::translate::{FromGlibPtrNone, IntoGlib, ToGlibPtr, ToGlibPtrMut};
use glib::IsA;

use super::WebContext;

pub trait WebContextExtManual {
  #[cfg(any(feature = "v2_16", docsrs))]
  #[cfg_attr(docsrs, doc(cfg(feature = "v2_16")))]
  #[doc(alias = "webkit_web_context_set_network_proxy_settings")]
  fn set_network_proxy_settings(
    &self,
    proxy_mode: NetworkProxyMode,
    proxy_settings: Option<&mut NetworkProxySettings>,
  );
}

impl<O> WebContextExtManual for O
where
  O: IsA<WebContext>,
{
  #[cfg(any(feature = "v2_16", docsrs))]
  #[cfg_attr(docsrs, doc(cfg(feature = "v2_16")))]
  fn set_network_proxy_settings(
    &self,
    proxy_mode: NetworkProxyMode,
    mut proxy_settings: Option<&mut NetworkProxySettings>,
  ) {
    unsafe {
      ffi::webkit_web_context_set_network_proxy_settings(
        self.as_ref().to_glib_none().0,
        proxy_mode.into_glib(),
        proxy_settings.to_glib_none_mut().0,
      );
    }
  }
}
