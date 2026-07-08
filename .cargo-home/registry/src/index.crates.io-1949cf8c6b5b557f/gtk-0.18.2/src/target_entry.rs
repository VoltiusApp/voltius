// Take a look at the license at the top of the repository in the LICENSE file.

use crate::TargetFlags;
use glib::translate::*;
use libc::c_char;
use std::ffi::CStr;

#[derive(Clone, Debug)]
#[repr(C)]
#[doc(alias = "GtkTargetEntry")]
pub struct TargetEntry {
    target: String,
    flags: TargetFlags,
    info: u32,
}

impl TargetEntry {
    pub fn new(target: &str, flags: TargetFlags, info: u32) -> TargetEntry {
        assert_initialized_main_thread!();
        Self {
            target: target.to_owned(),
            flags,
            info,
        }
    }

    #[doc(alias = "get_target")]
    pub fn target(&self) -> &str {
        &self.target
    }

    #[doc(alias = "get_flags")]
    pub fn flags(&self) -> TargetFlags {
        self.flags
    }

    #[doc(alias = "get_info")]
    pub fn info(&self) -> u32 {
        self.info
    }
}

#[doc(hidden)]
impl<'a> ToGlibPtr<'a, *const ffi::GtkTargetEntry> for TargetEntry {
    type Storage = (Box<ffi::GtkTargetEntry>, Stash<'a, *mut c_char, String>);

    #[inline]
    fn to_glib_none(&'a self) -> Stash<'a, *const ffi::GtkTargetEntry, Self> {
        let target = self.target.to_glib_none();

        let target_entry = Box::new(ffi::GtkTargetEntry {
            target: target.0,
            flags: self.flags.bits(),
            info: self.info,
        });
        Stash(&*target_entry, (target_entry, target))
    }
}

#[doc(hidden)]
impl<'a> ToGlibPtrMut<'a, *mut ffi::GtkTargetEntry> for TargetEntry {
    type Storage = (Box<ffi::GtkTargetEntry>, Stash<'a, *mut c_char, String>);

    #[inline]
    fn to_glib_none_mut(&'a mut self) -> StashMut<'a, *mut ffi::GtkTargetEntry, Self> {
        let target = self.target.to_glib_none();

        let mut target_entry = Box::new(ffi::GtkTargetEntry {
            target: target.0,
            flags: self.flags.bits(),
            info: self.info,
        });
        StashMut(&mut *target_entry, (target_entry, target))
    }
}

#[doc(hidden)]
impl FromGlibPtrNone<*const ffi::GtkTargetEntry> for TargetEntry {
    unsafe fn from_glib_none(ptr: *const ffi::GtkTargetEntry) -> Self {
        Self {
            target: CStr::from_ptr((*ptr).target).to_string_lossy().into_owned(),
            flags: TargetFlags::from_bits((*ptr).flags).unwrap(),
            info: (*ptr).info,
        }
    }
}

#[doc(hidden)]
impl FromGlibPtrNone<*mut ffi::GtkTargetEntry> for TargetEntry {
    unsafe fn from_glib_none(ptr: *mut ffi::GtkTargetEntry) -> Self {
        Self {
            target: CStr::from_ptr((*ptr).target).to_string_lossy().into_owned(),
            flags: TargetFlags::from_bits((*ptr).flags).unwrap(),
            info: (*ptr).info,
        }
    }
}

#[doc(hidden)]
impl FromGlibPtrFull<*mut ffi::GtkTargetEntry> for TargetEntry {
    #[inline]
    unsafe fn from_glib_full(ptr: *mut ffi::GtkTargetEntry) -> Self {
        let target_entry = Self {
            target: CStr::from_ptr((*ptr).target).to_string_lossy().into_owned(),
            flags: TargetFlags::from_bits((*ptr).flags).unwrap(),
            info: (*ptr).info,
        };
        ffi::gtk_target_entry_free(ptr);
        target_entry
    }
}

impl glib::StaticType for TargetEntry {
    fn static_type() -> glib::types::Type {
        skip_assert_initialized!();
        unsafe { from_glib(ffi::gtk_target_entry_get_type()) }
    }
}
