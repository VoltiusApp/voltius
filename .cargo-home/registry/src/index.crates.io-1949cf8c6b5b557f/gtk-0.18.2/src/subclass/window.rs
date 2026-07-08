// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;

use glib::subclass::prelude::*;

use glib::Cast;

use super::bin::BinImpl;

use crate::Widget;
use crate::Window;

pub trait WindowImpl: WindowImplExt + BinImpl {
    fn set_focus(&self, focus: Option<&Widget>) {
        self.parent_set_focus(focus)
    }

    fn activate_focus(&self) {
        self.parent_activate_focus()
    }

    fn activate_default(&self) {
        self.parent_activate_default()
    }

    fn keys_changed(&self) {
        self.parent_keys_changed()
    }

    fn enable_debugging(&self, toggle: bool) -> bool {
        self.parent_enable_debugging(toggle)
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: super::WindowImpl> Sealed for T {}
}

pub trait WindowImplExt: ObjectSubclass + sealed::Sealed {
    fn parent_set_focus(&self, focus: Option<&Widget>) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkWindowClass;
            if let Some(f) = (*parent_class).set_focus {
                f(
                    self.obj().unsafe_cast_ref::<Window>().to_glib_none().0,
                    focus.to_glib_none().0,
                )
            }
        }
    }
    fn parent_activate_focus(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkWindowClass;
            if let Some(f) = (*parent_class).activate_focus {
                f(self.obj().unsafe_cast_ref::<Window>().to_glib_none().0)
            }
        }
    }
    fn parent_activate_default(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkWindowClass;
            if let Some(f) = (*parent_class).activate_default {
                f(self.obj().unsafe_cast_ref::<Window>().to_glib_none().0)
            }
        }
    }
    fn parent_keys_changed(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkWindowClass;
            if let Some(f) = (*parent_class).keys_changed {
                f(self.obj().unsafe_cast_ref::<Window>().to_glib_none().0)
            }
        }
    }
    fn parent_enable_debugging(&self, toggle: bool) -> bool {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkWindowClass;
            if let Some(f) = (*parent_class).enable_debugging {
                from_glib(f(
                    self.obj().unsafe_cast_ref::<Window>().to_glib_none().0,
                    toggle.into_glib(),
                ))
            } else {
                false
            }
        }
    }
}

impl<T: WindowImpl> WindowImplExt for T {}

unsafe impl<T: WindowImpl> IsSubclassable<T> for Window {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }

        let klass = class.as_mut();
        klass.set_focus = Some(window_set_focus::<T>);
        klass.activate_focus = Some(window_activate_focus::<T>);
        klass.activate_default = Some(window_activate_default::<T>);
        klass.keys_changed = Some(window_keys_changed::<T>);
        klass.enable_debugging = Some(window_enable_debugging::<T>);
    }
}

unsafe extern "C" fn window_set_focus<T: WindowImpl>(
    ptr: *mut ffi::GtkWindow,
    widgetptr: *mut ffi::GtkWidget,
) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();
    let widget: Borrowed<Option<Widget>> = from_glib_borrow(widgetptr);

    imp.set_focus(widget.as_ref().as_ref())
}

unsafe extern "C" fn window_activate_focus<T: WindowImpl>(ptr: *mut ffi::GtkWindow) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.activate_focus()
}

unsafe extern "C" fn window_activate_default<T: WindowImpl>(ptr: *mut ffi::GtkWindow) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.activate_default()
}

unsafe extern "C" fn window_keys_changed<T: WindowImpl>(ptr: *mut ffi::GtkWindow) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.keys_changed()
}

unsafe extern "C" fn window_enable_debugging<T: WindowImpl>(
    ptr: *mut ffi::GtkWindow,
    toggleptr: glib::ffi::gboolean,
) -> glib::ffi::gboolean {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();
    let toggle: bool = from_glib(toggleptr);

    imp.enable_debugging(toggle).into_glib()
}
