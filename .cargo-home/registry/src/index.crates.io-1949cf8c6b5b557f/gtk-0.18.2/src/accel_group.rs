// Take a look at the license at the top of the repository in the LICENSE file.

use crate::AccelFlags;
use crate::AccelGroup;
use glib::object::{Cast, IsA};
use glib::translate::*;
use glib::ToValue;

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::AccelGroup>> Sealed for T {}
}

pub trait AccelGroupExtManual: IsA<AccelGroup> + sealed::Sealed + 'static {
    fn connect_accel_group<F>(
        &self,
        accel_key: u32,
        accel_mods: gdk::ModifierType,
        accel_flags: AccelFlags,
        func: F,
    ) -> glib::Closure
    where
        F: Fn(&Self, &glib::Object, u32, gdk::ModifierType) -> bool + 'static,
    {
        let closure = glib::Closure::new_local(move |values| {
            assert_eq!(values.len(), 4);
            let s = values[0]
                .get::<AccelGroup>()
                .expect("Wrong argument type for first closure argument");
            let s = s
                .downcast::<Self>()
                .expect("Wrong argument type for first closure argument");

            let obj = values[1]
                .get::<glib::Object>()
                .expect("Wrong argument type for second closure argument");
            let accel_key = values[2]
                .get::<u32>()
                .expect("Wrong argument type for third closure argument");
            let accel_mods = values[3]
                .get::<gdk::ModifierType>()
                .expect("Wrong argument type for fourth closure argument");

            let ret = func(&s, &obj, accel_key, accel_mods);

            Some(ret.to_value())
        });

        unsafe {
            ffi::gtk_accel_group_connect(
                self.as_ref().to_glib_none().0,
                accel_key,
                accel_mods.into_glib(),
                accel_flags.into_glib(),
                closure.to_glib_none().0,
            );
        }

        closure
    }

    fn connect_accel_group_by_path<F>(&self, accel_path: &str, func: F) -> glib::Closure
    where
        F: Fn(&Self, &glib::Object, u32, gdk::ModifierType) -> bool + 'static,
    {
        let closure = glib::Closure::new_local(move |values| {
            assert_eq!(values.len(), 4);
            let s = values[0]
                .get::<AccelGroup>()
                .expect("Wrong argument type for first closure argument");
            let s = s
                .downcast::<Self>()
                .expect("Wrong argument type for first closure argument");
            let obj = values[1]
                .get::<glib::Object>()
                .expect("Wrong argument type for second closure argument");
            let accel_key = values[2]
                .get::<u32>()
                .expect("Wrong argument type for third closure argument");
            let accel_mods = values[3]
                .get::<gdk::ModifierType>()
                .expect("Wrong argument type for fourth closure argument");

            let ret = func(&s, &obj, accel_key, accel_mods);

            Some(ret.to_value())
        });

        unsafe {
            ffi::gtk_accel_group_connect_by_path(
                self.as_ref().to_glib_none().0,
                accel_path.to_glib_none().0,
                closure.to_glib_none().0,
            );
        }

        closure
    }
}

impl<O: IsA<AccelGroup>> AccelGroupExtManual for O {}
