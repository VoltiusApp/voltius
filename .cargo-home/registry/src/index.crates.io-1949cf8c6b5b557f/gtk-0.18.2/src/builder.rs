// Take a look at the license at the top of the repository in the LICENSE file.

use crate::{Builder, Widget};
use glib::prelude::*;
use glib::translate::*;
use glib::GString;
use glib::Object;
use std::path::Path;
use std::ptr;

impl Builder {
    #[doc(alias = "gtk_builder_new_from_file")]
    pub fn from_file<T: AsRef<Path>>(file_path: T) -> Builder {
        assert_initialized_main_thread!();
        unsafe {
            from_glib_full(ffi::gtk_builder_new_from_file(
                file_path.as_ref().to_glib_none().0,
            ))
        }
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::Builder>> Sealed for T {}
}

pub trait BuilderExtManual: IsA<Builder> + sealed::Sealed + 'static {
    #[doc(alias = "gtk_builder_get_object")]
    #[doc(alias = "get_object")]
    fn object<T: IsA<Object>>(&self, name: &str) -> Option<T> {
        unsafe {
            Option::<Object>::from_glib_none(ffi::gtk_builder_get_object(
                self.upcast_ref().to_glib_none().0,
                name.to_glib_none().0,
            ))
            .and_then(|obj| obj.dynamic_cast::<T>().ok())
        }
    }

    #[doc(alias = "gtk_builder_add_from_file")]
    fn add_from_file<T: AsRef<Path>>(&self, file_path: T) -> Result<(), glib::Error> {
        unsafe {
            let mut error = ::std::ptr::null_mut();
            let exit_code = ffi::gtk_builder_add_from_file(
                self.upcast_ref().to_glib_none().0,
                file_path.as_ref().to_glib_none().0,
                &mut error,
            );
            assert_eq!(exit_code == 0, !error.is_null());
            if error.is_null() {
                Ok(())
            } else {
                Err(from_glib_full(error))
            }
        }
    }
    #[doc(alias = "gtk_builder_add_from_resource")]
    fn add_from_resource(&self, resource_path: &str) -> Result<(), glib::Error> {
        unsafe {
            let mut error = ptr::null_mut();
            let exit_code = ffi::gtk_builder_add_from_resource(
                self.as_ref().to_glib_none().0,
                resource_path.to_glib_none().0,
                &mut error,
            );
            assert_eq!(exit_code == 0, !error.is_null());
            if error.is_null() {
                Ok(())
            } else {
                Err(from_glib_full(error))
            }
        }
    }
    #[doc(alias = "gtk_builder_add_from_string")]
    fn add_from_string(&self, buffer: &str) -> Result<(), glib::Error> {
        let length = buffer.len();
        unsafe {
            let mut error = ptr::null_mut();
            let exit_code = ffi::gtk_builder_add_from_string(
                self.as_ref().to_glib_none().0,
                buffer.to_glib_none().0,
                length,
                &mut error,
            );
            assert_eq!(exit_code == 0, !error.is_null());
            if error.is_null() {
                Ok(())
            } else {
                Err(from_glib_full(error))
            }
        }
    }

    #[doc(alias = "gtk_builder_add_objects_from_resource")]
    fn add_objects_from_resource(
        &self,
        resource_path: &str,
        object_ids: &[&str],
    ) -> Result<(), glib::Error> {
        unsafe {
            let mut error = ptr::null_mut();
            let exit_code = ffi::gtk_builder_add_objects_from_resource(
                self.as_ref().to_glib_none().0,
                resource_path.to_glib_none().0,
                object_ids.to_glib_none().0,
                &mut error,
            );
            assert_eq!(exit_code == 0, !error.is_null());
            if error.is_null() {
                Ok(())
            } else {
                Err(from_glib_full(error))
            }
        }
    }
    #[doc(alias = "gtk_builder_add_objects_from_string")]
    fn add_objects_from_string(
        &self,
        buffer: &str,
        object_ids: &[&str],
    ) -> Result<(), glib::Error> {
        let length = buffer.len();
        unsafe {
            let mut error = ptr::null_mut();
            let exit_code = ffi::gtk_builder_add_objects_from_string(
                self.as_ref().to_glib_none().0,
                buffer.to_glib_none().0,
                length,
                object_ids.to_glib_none().0,
                &mut error,
            );
            assert_eq!(exit_code == 0, !error.is_null());
            if error.is_null() {
                Ok(())
            } else {
                Err(from_glib_full(error))
            }
        }
    }

    #[doc(alias = "gtk_builder_connect_signals_full")]
    fn connect_signals<
        P: FnMut(&Builder, &str) -> Box<dyn Fn(&[glib::Value]) -> Option<glib::Value> + 'static>,
    >(
        &self,
        func: P,
    ) {
        let func_data: P = func;
        unsafe extern "C" fn func_func<
            P: FnMut(&Builder, &str) -> Box<dyn Fn(&[glib::Value]) -> Option<glib::Value> + 'static>,
        >(
            builder: *mut ffi::GtkBuilder,
            object: *mut glib::gobject_ffi::GObject,
            signal_name: *const libc::c_char,
            handler_name: *const libc::c_char,
            connect_object: *mut glib::gobject_ffi::GObject,
            flags: glib::gobject_ffi::GConnectFlags,
            user_data: glib::ffi::gpointer,
        ) {
            assert!(connect_object.is_null(), "Connect object is not supported");
            assert!(
                flags & glib::gobject_ffi::G_CONNECT_SWAPPED == 0,
                "Swapped signal handler is not supported"
            );

            let builder = from_glib_borrow(builder);
            let object: Borrowed<glib::Object> = from_glib_borrow(object);
            let signal_name: Borrowed<GString> = from_glib_borrow(signal_name);
            let handler_name: Borrowed<GString> = from_glib_borrow(handler_name);
            let callback: *mut P = user_data as *const _ as usize as *mut P;
            let func = (*callback)(&builder, handler_name.as_str());
            object.connect_unsafe(
                signal_name.as_str(),
                flags & glib::gobject_ffi::G_CONNECT_AFTER != 0,
                move |args| func(args),
            );
        }
        let func = Some(func_func::<P> as _);
        let super_callback0: &P = &func_data;
        unsafe {
            ffi::gtk_builder_connect_signals_full(
                self.as_ref().to_glib_none().0,
                func,
                super_callback0 as *const _ as usize as *mut _,
            );
        }
    }

    #[doc(alias = "gtk_builder_extend_with_template")]
    fn extend_with_template(
        &self,
        widget: &impl IsA<Widget>,
        template_type: glib::types::Type,
        buffer: &str,
    ) -> Result<(), glib::Error> {
        let length = buffer.len();
        unsafe {
            let mut error = ptr::null_mut();
            let exit_code = ffi::gtk_builder_extend_with_template(
                self.as_ref().to_glib_none().0,
                widget.as_ref().to_glib_none().0,
                template_type.into_glib(),
                buffer.to_glib_none().0,
                length,
                &mut error,
            );
            assert_eq!(exit_code == 0, !error.is_null());
            if error.is_null() {
                Ok(())
            } else {
                Err(from_glib_full(error))
            }
        }
    }
}

impl<O: IsA<Builder>> BuilderExtManual for O {}
