// Take a look at the license at the top of the repository in the LICENSE file.

use glib::subclass::prelude::*;
use glib::translate::*;
use glib::Cast;

use super::widget::WidgetImpl;
use crate::Entry;
use crate::Widget;

pub trait EntryImpl: EntryImplExt + WidgetImpl {
    fn populate_popup(&self, popup: &Widget) {
        self.parent_populate_popup(popup)
    }

    fn activate(&self) {
        self.parent_activate()
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: super::EntryImpl> Sealed for T {}
}

pub trait EntryImplExt: ObjectSubclass + sealed::Sealed {
    fn parent_populate_popup(&self, popup: &Widget) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkEntryClass;
            if let Some(f) = (*parent_class).populate_popup {
                f(
                    self.obj().unsafe_cast_ref::<Entry>().to_glib_none().0,
                    popup.to_glib_none().0,
                )
            }
        }
    }
    fn parent_activate(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkEntryClass;
            if let Some(f) = (*parent_class).activate {
                f(self.obj().unsafe_cast_ref::<Entry>().to_glib_none().0)
            }
        }
    }
}

impl<T: EntryImpl> EntryImplExt for T {}

unsafe impl<T: EntryImpl> IsSubclassable<T> for Entry {
    fn class_init(class: &mut glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }

        let klass = class.as_mut();
        klass.populate_popup = Some(entry_populate_popup::<T>);
        klass.activate = Some(entry_activate::<T>);
    }
}

unsafe extern "C" fn entry_populate_popup<T: EntryImpl>(
    ptr: *mut ffi::GtkEntry,
    popupptr: *mut ffi::GtkWidget,
) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();
    let popup: Borrowed<Widget> = from_glib_borrow(popupptr);

    imp.populate_popup(&popup)
}

unsafe extern "C" fn entry_activate<T: EntryImpl>(ptr: *mut ffi::GtkEntry) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.activate()
}
