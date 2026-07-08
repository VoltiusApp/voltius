// Take a look at the license at the top of the repository in the LICENSE file.

use libc::{c_char, c_uint};

use glib::subclass::prelude::*;
use glib::translate::*;
use glib::{Cast, GString};

use super::cell_renderer_text::CellRendererTextImpl;
use crate::CellRendererAccel;

pub trait CellRendererAccelImpl: CellRendererAccelImplExt + CellRendererTextImpl {
    fn accel_edited(
        &self,
        path: &str,
        accel_key: u32,
        accel_mods: gdk::ModifierType,
        hardware_keycode: u32,
    ) {
        self.parent_accel_edited(path, accel_key, accel_mods, hardware_keycode);
    }

    fn accel_cleared(&self, path: &str) {
        self.parent_accel_cleared(path);
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: super::CellRendererAccelImpl> Sealed for T {}
}

pub trait CellRendererAccelImplExt: ObjectSubclass + sealed::Sealed {
    fn parent_accel_edited(
        &self,
        path: &str,
        accel_key: u32,
        accel_mods: gdk::ModifierType,
        hardware_keycode: u32,
    ) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkCellRendererAccelClass;
            if let Some(f) = (*parent_class).accel_edited {
                f(
                    self.obj()
                        .unsafe_cast_ref::<CellRendererAccel>()
                        .to_glib_none()
                        .0,
                    path.to_glib_none().0,
                    accel_key,
                    accel_mods.into_glib(),
                    hardware_keycode,
                )
            }
        }
    }
    fn parent_accel_cleared(&self, path: &str) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkCellRendererAccelClass;
            if let Some(f) = (*parent_class).accel_cleared {
                f(
                    self.obj()
                        .unsafe_cast_ref::<CellRendererAccel>()
                        .to_glib_none()
                        .0,
                    path.to_glib_none().0,
                )
            }
        }
    }
}

impl<T: CellRendererAccelImpl> CellRendererAccelImplExt for T {}

unsafe impl<T: CellRendererAccelImpl> IsSubclassable<T> for CellRendererAccel {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }

        let klass = class.as_mut();
        klass.accel_edited = Some(cell_renderer_accel_edited::<T>);
        klass.accel_cleared = Some(cell_renderer_accel_cleared::<T>);
    }
}

unsafe extern "C" fn cell_renderer_accel_edited<T: CellRendererAccelImpl>(
    ptr: *mut ffi::GtkCellRendererAccel,
    path: *const c_char,
    accel_key: c_uint,
    accel_mods: gdk::ffi::GdkModifierType,
    hardware_keycode: c_uint,
) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.accel_edited(
        &GString::from_glib_borrow(path),
        accel_key,
        from_glib(accel_mods),
        hardware_keycode,
    )
}

unsafe extern "C" fn cell_renderer_accel_cleared<T: CellRendererAccelImpl>(
    ptr: *mut ffi::GtkCellRendererAccel,
    path: *const c_char,
) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.accel_cleared(&GString::from_glib_borrow(path))
}
