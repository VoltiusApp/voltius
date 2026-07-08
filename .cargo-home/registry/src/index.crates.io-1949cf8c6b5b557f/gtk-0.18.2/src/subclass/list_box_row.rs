// Take a look at the license at the top of the repository in the LICENSE file.

use crate::ListBoxRow;

use glib::subclass::prelude::*;
use glib::translate::*;
use glib::Cast;

use super::bin::BinImpl;

pub trait ListBoxRowImpl: ListBoxRowImplExt + BinImpl {
    fn activate(&self) {
        self.parent_activate()
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: super::ListBoxRowImpl> Sealed for T {}
}

pub trait ListBoxRowImplExt: ObjectSubclass + sealed::Sealed {
    fn parent_activate(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkListBoxRowClass;
            if let Some(f) = (*parent_class).activate {
                f(self.obj().unsafe_cast_ref::<ListBoxRow>().to_glib_none().0)
            }
        }
    }
}

impl<T: ListBoxRowImpl> ListBoxRowImplExt for T {}

unsafe impl<T: ListBoxRowImpl> IsSubclassable<T> for ListBoxRow {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }

        let klass = class.as_mut();
        klass.activate = Some(list_box_row_activate::<T>);
    }
}

unsafe extern "C" fn list_box_row_activate<T: ListBoxRowImpl>(ptr: *mut ffi::GtkListBoxRow) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.activate()
}
