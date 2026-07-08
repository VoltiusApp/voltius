use glib::translate::*;
use std::mem;
use std::os::raw::c_void;

glib::wrapper! {
    #[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
    pub struct Value(Shared<ffi::SecretValue>);

    match fn {
        ref => |ptr| ffi::secret_value_ref(ptr),
        // Manual
        unref => |ptr| ffi::secret_value_unref(ptr as *mut _ as *mut c_void),
        type_ => || ffi::secret_value_get_type(),
    }
}

impl Value {
    #[doc(alias = "secret_value_new")]
    pub fn new(secret: &str, content_type: &str) -> Value {
        let length = secret.len() as isize;
        unsafe {
            from_glib_full(ffi::secret_value_new(
                secret.to_glib_none().0,
                length,
                content_type.to_glib_none().0,
            ))
        }
    }

    #[doc(alias = "secret_value_get")]
    pub fn get(&self) -> Vec<u8> {
        unsafe {
            let mut length = mem::MaybeUninit::uninit();
            let ret = FromGlibContainer::from_glib_none_num(
                ffi::secret_value_get(self.to_glib_none().0, length.as_mut_ptr()),
                length.assume_init() as _,
            );
            ret
        }
    }

    #[doc(alias = "secret_value_get_content_type")]
    #[doc(alias = "get_content_type")]
    pub fn content_type(&self) -> glib::GString {
        unsafe { from_glib_none(ffi::secret_value_get_content_type(self.to_glib_none().0)) }
    }

    #[doc(alias = "secret_value_get_text")]
    #[doc(alias = "get_text")]
    pub fn text(&self) -> Option<glib::GString> {
        unsafe { from_glib_none(ffi::secret_value_get_text(self.to_glib_none().0)) }
    }

    #[cfg(any(feature = "v0_19", feature = "dox"))]
    #[cfg_attr(feature = "dox", doc(cfg(feature = "v0_19")))]
    #[doc(alias = "secret_value_unref_to_password")]
    pub fn unref_to_password(&self) -> glib::GString {
        unsafe {
            let mut length = std::mem::MaybeUninit::uninit();
            let password =
                ffi::secret_value_unref_to_password(self.to_glib_none().0, length.as_mut_ptr());
            length.assume_init();

            from_glib_full(password)
        }
    }
}
