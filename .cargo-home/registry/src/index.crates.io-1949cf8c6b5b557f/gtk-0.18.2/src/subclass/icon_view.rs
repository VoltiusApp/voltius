// Take a look at the license at the top of the repository in the LICENSE file.

use libc::c_int;

use glib::subclass::prelude::*;
use glib::translate::*;
use glib::Cast;

use super::container::ContainerImpl;

use crate::IconView;
use crate::MovementStep;
use crate::TreePath;

pub trait IconViewImpl: IconViewImplExt + ContainerImpl {
    fn item_activated(&self, path: &TreePath) {
        self.parent_item_activated(path)
    }
    fn selection_changed(&self) {
        self.parent_selection_changed()
    }
    fn select_all(&self) {
        self.parent_select_all()
    }
    fn unselect_all(&self) {
        self.parent_unselect_all()
    }
    fn select_cursor_item(&self) {
        self.parent_select_cursor_item()
    }
    fn toggle_cursor_item(&self) {
        self.parent_toggle_cursor_item()
    }
    fn move_cursor(&self, step: MovementStep, count: i32) -> bool {
        self.parent_move_cursor(step, count)
    }
    fn activate_cursor_item(&self) -> bool {
        self.parent_activate_cursor_item()
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: super::IconViewImpl> Sealed for T {}
}

pub trait IconViewImplExt: ObjectSubclass + sealed::Sealed {
    fn parent_item_activated(&self, path: &TreePath) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkIconViewClass;
            if let Some(f) = (*parent_class).item_activated {
                f(
                    self.obj().unsafe_cast_ref::<IconView>().to_glib_none().0,
                    mut_override(path.to_glib_none().0),
                )
            }
        }
    }
    fn parent_selection_changed(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkIconViewClass;
            if let Some(f) = (*parent_class).selection_changed {
                f(self.obj().unsafe_cast_ref::<IconView>().to_glib_none().0)
            }
        }
    }
    fn parent_select_all(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkIconViewClass;
            if let Some(f) = (*parent_class).select_all {
                f(self.obj().unsafe_cast_ref::<IconView>().to_glib_none().0)
            }
        }
    }
    fn parent_unselect_all(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkIconViewClass;
            if let Some(f) = (*parent_class).unselect_all {
                f(self.obj().unsafe_cast_ref::<IconView>().to_glib_none().0)
            }
        }
    }
    fn parent_select_cursor_item(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkIconViewClass;
            if let Some(f) = (*parent_class).select_cursor_item {
                f(self.obj().unsafe_cast_ref::<IconView>().to_glib_none().0)
            }
        }
    }
    fn parent_toggle_cursor_item(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkIconViewClass;
            if let Some(f) = (*parent_class).toggle_cursor_item {
                f(self.obj().unsafe_cast_ref::<IconView>().to_glib_none().0)
            }
        }
    }
    fn parent_move_cursor(&self, step: MovementStep, count: i32) -> bool {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkIconViewClass;
            if let Some(f) = (*parent_class).move_cursor {
                from_glib(f(
                    self.obj().unsafe_cast_ref::<IconView>().to_glib_none().0,
                    step.into_glib(),
                    count,
                ))
            } else {
                false
            }
        }
    }
    fn parent_activate_cursor_item(&self) -> bool {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkIconViewClass;
            if let Some(f) = (*parent_class).activate_cursor_item {
                from_glib(f(self.obj().unsafe_cast_ref::<IconView>().to_glib_none().0))
            } else {
                false
            }
        }
    }
}

impl<T: IconViewImpl> IconViewImplExt for T {}

unsafe impl<T: IconViewImpl> IsSubclassable<T> for IconView {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }

        let klass = class.as_mut();
        klass.item_activated = Some(icon_view_item_activated::<T>);
        klass.selection_changed = Some(icon_view_selection_changed::<T>);
        klass.select_all = Some(icon_view_select_all::<T>);
        klass.unselect_all = Some(icon_view_unselect_all::<T>);
        klass.select_cursor_item = Some(icon_view_select_cursor_item::<T>);
        klass.toggle_cursor_item = Some(icon_view_toggle_cursor_item::<T>);
        klass.move_cursor = Some(icon_view_move_cursor::<T>);
        klass.activate_cursor_item = Some(icon_view_activate_cursor_item::<T>);
    }
}

unsafe extern "C" fn icon_view_item_activated<T: IconViewImpl>(
    ptr: *mut ffi::GtkIconView,
    path: *mut ffi::GtkTreePath,
) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();
    let path = from_glib_borrow(path);

    imp.item_activated(&path)
}

unsafe extern "C" fn icon_view_selection_changed<T: IconViewImpl>(ptr: *mut ffi::GtkIconView) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.selection_changed()
}

unsafe extern "C" fn icon_view_select_all<T: IconViewImpl>(ptr: *mut ffi::GtkIconView) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.select_all()
}

unsafe extern "C" fn icon_view_unselect_all<T: IconViewImpl>(ptr: *mut ffi::GtkIconView) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.unselect_all()
}

unsafe extern "C" fn icon_view_select_cursor_item<T: IconViewImpl>(ptr: *mut ffi::GtkIconView) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.select_cursor_item()
}

unsafe extern "C" fn icon_view_toggle_cursor_item<T: IconViewImpl>(ptr: *mut ffi::GtkIconView) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.toggle_cursor_item()
}

unsafe extern "C" fn icon_view_move_cursor<T: IconViewImpl>(
    ptr: *mut ffi::GtkIconView,
    step: ffi::GtkMovementStep,
    count: c_int,
) -> glib::ffi::gboolean {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.move_cursor(from_glib(step), count).into_glib()
}

unsafe extern "C" fn icon_view_activate_cursor_item<T: IconViewImpl>(
    ptr: *mut ffi::GtkIconView,
) -> glib::ffi::gboolean {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.activate_cursor_item().into_glib()
}
