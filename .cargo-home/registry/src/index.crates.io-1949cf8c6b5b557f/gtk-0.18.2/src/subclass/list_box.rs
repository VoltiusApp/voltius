// Take a look at the license at the top of the repository in the LICENSE file.

use glib::subclass::prelude::*;
use glib::translate::*;
use glib::Cast;

use super::{container::ContainerImpl, widget::WidgetImpl};

use libc::c_int;

use crate::ListBox;
use crate::ListBoxRow;
use crate::MovementStep;

pub trait ListBoxImpl: ListBoxImplExt + ContainerImpl + WidgetImpl {
    fn activate_cursor_row(&self) {
        self.list_box_activate_cursor_row()
    }

    fn move_cursor(&self, step: MovementStep, count: i32) {
        self.list_box_move_cursor(step, count)
    }

    fn row_activated(&self, row: &ListBoxRow) {
        self.list_box_row_activated(row)
    }

    fn row_selected(&self, row: Option<&ListBoxRow>) {
        self.list_box_row_selected(row)
    }

    fn select_all(&self) {
        self.list_box_select_all()
    }

    fn selected_rows_changed(&self) {
        self.list_box_selected_rows_changed()
    }

    fn toggle_cursor_row(&self) {
        self.list_box_toggle_cursor_row()
    }

    fn unselect_all(&self) {
        self.list_box_unselect_all()
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: super::ListBoxImpl> Sealed for T {}
}

pub trait ListBoxImplExt: ObjectSubclass + sealed::Sealed {
    fn list_box_activate_cursor_row(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkListBoxClass;
            if let Some(f) = (*parent_class).activate_cursor_row {
                f(self.obj().unsafe_cast_ref::<ListBox>().to_glib_none().0)
            }
        }
    }
    fn list_box_move_cursor(&self, step: MovementStep, count: i32) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkListBoxClass;
            if let Some(f) = (*parent_class).move_cursor {
                f(
                    self.obj().unsafe_cast_ref::<ListBox>().to_glib_none().0,
                    step.into_glib(),
                    count,
                );
            }
        }
    }
    fn list_box_row_activated(&self, row: &ListBoxRow) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkListBoxClass;
            if let Some(f) = (*parent_class).row_activated {
                f(
                    self.obj().unsafe_cast_ref::<ListBox>().to_glib_none().0,
                    row.to_glib_none().0,
                )
            }
        }
    }
    fn list_box_row_selected(&self, row: Option<&ListBoxRow>) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkListBoxClass;
            if let Some(f) = (*parent_class).row_selected {
                f(
                    self.obj().unsafe_cast_ref::<ListBox>().to_glib_none().0,
                    mut_override(row.to_glib_none().0),
                )
            }
        }
    }
    fn list_box_select_all(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkListBoxClass;
            if let Some(f) = (*parent_class).select_all {
                f(self.obj().unsafe_cast_ref::<ListBox>().to_glib_none().0)
            }
        }
    }
    fn list_box_selected_rows_changed(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkListBoxClass;
            if let Some(f) = (*parent_class).selected_rows_changed {
                f(self.obj().unsafe_cast_ref::<ListBox>().to_glib_none().0)
            }
        }
    }
    fn list_box_toggle_cursor_row(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkListBoxClass;
            if let Some(f) = (*parent_class).toggle_cursor_row {
                f(self.obj().unsafe_cast_ref::<ListBox>().to_glib_none().0)
            }
        }
    }
    fn list_box_unselect_all(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkListBoxClass;
            if let Some(f) = (*parent_class).unselect_all {
                f(self.obj().unsafe_cast_ref::<ListBox>().to_glib_none().0)
            }
        }
    }
}

impl<T: ListBoxImpl> ListBoxImplExt for T {}

unsafe impl<T: ListBoxImpl> IsSubclassable<T> for ListBox {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }

        let klass = class.as_mut();
        klass.activate_cursor_row = Some(list_box_activate_cursor_row::<T>);
        klass.move_cursor = Some(list_box_move_cursor::<T>);
        klass.row_activated = Some(list_box_row_activated::<T>);
        klass.row_selected = Some(list_box_row_selected::<T>);
        klass.select_all = Some(list_box_select_all::<T>);
        klass.selected_rows_changed = Some(list_box_selected_rows_changed::<T>);
        klass.toggle_cursor_row = Some(list_box_toggle_cursor_row::<T>);
        klass.unselect_all = Some(list_box_unselect_all::<T>);
    }
}

unsafe extern "C" fn list_box_activate_cursor_row<T: ListBoxImpl>(ptr: *mut ffi::GtkListBox) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.activate_cursor_row()
}

unsafe extern "C" fn list_box_move_cursor<T: ListBoxImpl>(
    ptr: *mut ffi::GtkListBox,
    step: ffi::GtkMovementStep,
    count: c_int,
) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.move_cursor(from_glib(step), count)
}

unsafe extern "C" fn list_box_row_activated<T: ListBoxImpl>(
    ptr: *mut ffi::GtkListBox,
    rowptr: *mut ffi::GtkListBoxRow,
) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();
    let row: Borrowed<ListBoxRow> = from_glib_borrow(rowptr);

    imp.row_activated(&row)
}

unsafe extern "C" fn list_box_row_selected<T: ListBoxImpl>(
    ptr: *mut ffi::GtkListBox,
    rowptr: *mut ffi::GtkListBoxRow,
) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();
    let row: Borrowed<Option<ListBoxRow>> = from_glib_borrow(rowptr);

    imp.row_selected(row.as_ref().as_ref())
}

unsafe extern "C" fn list_box_select_all<T: ListBoxImpl>(ptr: *mut ffi::GtkListBox) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.select_all()
}

unsafe extern "C" fn list_box_selected_rows_changed<T: ListBoxImpl>(ptr: *mut ffi::GtkListBox) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.selected_rows_changed()
}

unsafe extern "C" fn list_box_toggle_cursor_row<T: ListBoxImpl>(ptr: *mut ffi::GtkListBox) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.toggle_cursor_row()
}

unsafe extern "C" fn list_box_unselect_all<T: ListBoxImpl>(ptr: *mut ffi::GtkListBox) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.unselect_all()
}
