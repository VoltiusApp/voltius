// Take a look at the license at the top of the repository in the LICENSE file.

use glib::subclass::prelude::*;

use glib::translate::*;
use glib::Cast;

use super::container::ContainerImpl;

use crate::Socket;

pub trait SocketImpl: SocketImplExt + ContainerImpl {
    fn plug_added(&self) {
        self.parent_plug_added()
    }

    fn plug_removed(&self) -> glib::Propagation {
        self.parent_plug_removed()
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: super::SocketImpl> Sealed for T {}
}

pub trait SocketImplExt: ObjectSubclass + sealed::Sealed {
    fn parent_plug_added(&self) {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkSocketClass;
            if let Some(f) = (*parent_class).plug_added {
                f(self.obj().unsafe_cast_ref::<Socket>().to_glib_none().0)
            }
        }
    }
    fn parent_plug_removed(&self) -> glib::Propagation {
        unsafe {
            let data = Self::type_data();
            let parent_class = data.as_ref().parent_class() as *mut ffi::GtkSocketClass;
            if let Some(f) = (*parent_class).plug_removed {
                glib::Propagation::from_glib(f(self
                    .obj()
                    .unsafe_cast_ref::<Socket>()
                    .to_glib_none()
                    .0))
            } else {
                glib::Propagation::Proceed
            }
        }
    }
}

impl<T: SocketImpl> SocketImplExt for T {}

unsafe impl<T: SocketImpl> IsSubclassable<T> for Socket {
    fn class_init(class: &mut ::glib::Class<Self>) {
        Self::parent_class_init::<T>(class);

        if !crate::rt::is_initialized() {
            panic!("GTK has to be initialized first");
        }

        let klass = class.as_mut();
        klass.plug_added = Some(socket_plug_added::<T>);
        klass.plug_removed = Some(socket_plug_removed::<T>);
    }
}

unsafe extern "C" fn socket_plug_added<T: SocketImpl>(ptr: *mut ffi::GtkSocket) {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.plug_added()
}

unsafe extern "C" fn socket_plug_removed<T: SocketImpl>(
    ptr: *mut ffi::GtkSocket,
) -> glib::ffi::gboolean {
    let instance = &*(ptr as *mut T::Instance);
    let imp = instance.imp();

    imp.plug_removed().into_glib()
}
