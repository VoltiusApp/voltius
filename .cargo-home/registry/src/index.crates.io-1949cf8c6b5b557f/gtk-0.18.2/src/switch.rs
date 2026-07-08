// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Switch;
use glib::object::{Cast, IsA};
use glib::signal::{connect_raw, SignalHandlerId};
use glib::translate::*;
use std::boxed::Box as Box_;
use std::mem::transmute;

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::Switch>> Sealed for T {}
}

pub trait SwitchExtManual: IsA<Switch> + sealed::Sealed + 'static {
    fn connect_changed_active<F: Fn(&Self) + 'static>(&self, f: F) -> SignalHandlerId {
        unsafe extern "C" fn changed_active_trampoline<T, F: Fn(&T) + 'static>(
            this: *mut ffi::GtkSwitch,
            _gparamspec: glib::ffi::gpointer,
            f: glib::ffi::gpointer,
        ) where
            T: IsA<Switch>,
        {
            let f: &F = &*(f as *const F);
            f(Switch::from_glib_borrow(this).unsafe_cast_ref())
        }
        unsafe {
            let f: Box_<F> = Box_::new(f);
            connect_raw(
                self.to_glib_none().0 as *mut _,
                b"notify::active\0".as_ptr() as *mut _,
                Some(transmute::<_, unsafe extern "C" fn()>(
                    changed_active_trampoline::<Self, F> as *const (),
                )),
                Box_::into_raw(f),
            )
        }
    }
}

impl<O: IsA<Switch>> SwitchExtManual for O {}
