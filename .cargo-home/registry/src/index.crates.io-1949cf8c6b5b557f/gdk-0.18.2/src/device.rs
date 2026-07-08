// Take a look at the license at the top of the repository in the LICENSE file.

use crate::AxisUse;
use crate::Device;
use crate::TimeCoord;
use crate::Window;
use glib::object::IsA;
use glib::translate::*;

use std::mem;
use std::ptr;

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::Device>> Sealed for T {}
}

pub trait DeviceExtManual: IsA<Device> + sealed::Sealed + 'static {
    #[doc(alias = "gdk_device_get_axis")]
    #[doc(alias = "get_axis")]
    fn is_axis(&self, axes: &mut [f64], use_: AxisUse, value: &mut f64) -> bool {
        unsafe {
            from_glib(ffi::gdk_device_get_axis(
                self.as_ref().to_glib_none().0,
                axes.as_mut_ptr(),
                use_.into_glib(),
                value,
            ))
        }
    }

    #[doc(alias = "gdk_device_get_history")]
    #[doc(alias = "get_history")]
    fn history<P: IsA<Window>>(&self, window: &P, start: u32, stop: u32) -> Vec<TimeCoord> {
        unsafe {
            let mut events = ptr::null_mut();
            let mut n_events = mem::MaybeUninit::uninit();
            let ret: bool = from_glib(ffi::gdk_device_get_history(
                self.as_ref().to_glib_none().0,
                window.as_ref().to_glib_none().0,
                start,
                stop,
                &mut events,
                n_events.as_mut_ptr(),
            ));
            if !ret {
                return Vec::new();
            }
            let n_events = n_events.assume_init() as usize;
            FromGlibContainer::from_glib_full_num(events, n_events)
        }
    }
}

impl<O: IsA<Device>> DeviceExtManual for O {}
