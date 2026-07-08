// Take a look at the license at the top of the repository in the LICENSE file.

use glib::subclass::prelude::*;

use glib::translate::*;
use glib::Cast;

use super::window::WindowImpl;
use crate::Plug;

pub trait PlugImpl: PlugImplExt + WindowImpl {
    fn embedded(&self) {
        self.parent_embedded()
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: super::PlugImpl> Sealed for T {}
}

pub trait PlugImplExt: ObjectSubclass + sealed::Sealed {
    fn parent_embedded(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkPlugClass;
            if let Some(f) = (*parent_class).embedded {
                f(self.obj().unsafe_cast_ref::<Plug>().to_glib_none().0)
            }
        }
    }
}

impl<T: PlugImpl> PlugImplExt for T {}

unsafe impl<T: PlugImpl> IsSubclassable<T> for Plug {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }

        let klass = class.as_mut();
        klass.embedded = Some(plug_embedded::<T>);
    }
}

unsafe extern "C" fn plug_embedded<T: PlugImpl>(ptr: *mut ffi::GtkPlug) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.embedded()
}
