// Take a look at the license at the top of the repository in the LICENSE file.

#[cfg(feature = "v3_24")]
use crate::GestureStylus;
use gdk::AxisUse;
use glib::object::IsA;
use glib::translate::*;

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::GestureStylus>> Sealed for T {}
}

pub trait GestureStylusExtManual: IsA<GestureStylus> + sealed::Sealed + 'static {
    #[cfg(feature = "v3_24")]
    #[cfg_attr(docsrs, doc(cfg(feature = "v3_24")))]
    #[doc(alias = "gtk_gesture_stylus_get_axes")]
    #[doc(alias = "get_axes")]
    fn axes(&self, axes: Vec<AxisUse>) -> Option<Vec<f64>> {
        let mut values: Vec<f64> = Vec::new();
        unsafe {
            let mut axes1: Vec<gdk::ffi::GdkAxisUse> = axes.iter().map(|a| a.into_glib()).collect();
            axes1.push(gdk::ffi::GDK_AXIS_IGNORE);
            if from_glib(ffi::gtk_gesture_stylus_get_axes(
                self.as_ref().to_glib_none().0,
                axes1.as_mut_ptr(),
                values.as_mut_ptr() as *mut *mut f64,
            )) {
                Some(values)
            } else {
                None
            }
        }
    }
}

impl<O: IsA<GestureStylus>> GestureStylusExtManual for O {}
