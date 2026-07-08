// Take a look at the license at the top of the repository in the LICENSE file.

use glib::prelude::*;

use crate::{DBusConnection, DebugControllerDBus};

mod sealed {
    pub trait Sealed {}
    impl<T: super::IsA<super::DebugControllerDBus>> Sealed for T {}
}

pub trait DebugControllerDBusExtManual: sealed::Sealed + IsA<DebugControllerDBus> + Sized {
    fn connection(&self) -> DBusConnection {
        glib::ObjectExt::property(self.as_ref(), "connection")
    }
}

impl<O: IsA<DebugControllerDBus>> DebugControllerDBusExtManual for O {}
