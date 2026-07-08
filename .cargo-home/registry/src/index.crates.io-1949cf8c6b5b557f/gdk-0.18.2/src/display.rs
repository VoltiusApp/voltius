// Take a look at the license at the top of the repository in the LICENSE file.

use crate::Display;
use glib::object::IsA;
use glib::ObjectExt;

#[derive(Debug, PartialEq, Eq, Ord, PartialOrd)]
pub enum Backend {
    Wayland,
    X11,
    Win32,
    MacOS,
    Broadway,
}

impl Backend {
    // rustdoc-stripper-ignore-next
    /// Equivalent to the C macro `GDK_IS_WAYLAND_DISPLAY`
    #[doc(alias = "GDK_IS_WAYLAND_DISPLAY")]
    pub fn is_wayland(&self) -> bool {
        matches!(self, Self::Wayland)
    }

    // rustdoc-stripper-ignore-next
    /// Equivalent to the C macro `GDK_IS_X11_DISPLAY`
    #[doc(alias = "GDK_IS_X11_DISPLAY")]
    pub fn is_x11(&self) -> bool {
        matches!(self, Self::X11)
    }

    // rustdoc-stripper-ignore-next
    /// Equivalent to the C macro `GDK_IS_WIN32_DISPLAY`
    #[doc(alias = "GDK_IS_WIN32_DISPLAY")]
    pub fn is_win32(&self) -> bool {
        matches!(self, Self::Win32)
    }

    // rustdoc-stripper-ignore-next
    /// Equivalent to the C macro `GDK_IS_QUARTZ_DISPLAY`
    #[doc(alias = "GDK_IS_QUARTZ_DISPLAY")]
    pub fn is_macos(&self) -> bool {
        matches!(self, Self::MacOS)
    }

    // rustdoc-stripper-ignore-next
    /// Equivalent to the C macro `GDK_IS_BROADWAY_DISPLAY`
    #[doc(alias = "GDK_IS_BROADWAY_DISPLAY")]
    pub fn is_broadway(&self) -> bool {
        matches!(self, Self::Broadway)
    }
}

mod sealed {
    pub trait Sealed {}
    impl<T: glib::IsA<crate::Display>> Sealed for T {}
}

pub trait DisplayExtManual: IsA<Display> + sealed::Sealed + 'static {
    // rustdoc-stripper-ignore-next
    /// Get the currently used display backend
    fn backend(&self) -> Backend {
        match self.as_ref().type_().name() {
            "GdkWaylandDisplay" => Backend::Wayland,
            "GdkX11Display" => Backend::X11,
            "GdkQuartzDisplay" => Backend::MacOS,
            "GdkWin32Display" => Backend::Win32,
            "GdkBroadwayDisplay" => Backend::Broadway,
            e => panic!("Unsupported display backend {e}"),
        }
    }
}

impl<O: IsA<Display>> DisplayExtManual for O {}
