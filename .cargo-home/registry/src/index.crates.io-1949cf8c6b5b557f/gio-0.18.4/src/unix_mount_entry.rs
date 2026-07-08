// Take a look at the license at the top of the repository in the LICENSE file.

use std::{cmp, mem};

use glib::{translate::*, GString};

use crate::{Icon, UnixMountEntry};

impl UnixMountEntry {
    #[doc(alias = "g_unix_mount_at")]
    #[doc(alias = "new_at")]
    pub fn for_mount_path<P: AsRef<std::path::Path>>(
        mount_path: P,
    ) -> (Option<UnixMountEntry>, u64) {
        unsafe {
            let mut time_read = mem::MaybeUninit::uninit();
            let ret = from_glib_full(ffi::g_unix_mount_at(
                mount_path.as_ref().to_glib_none().0,
                time_read.as_mut_ptr(),
            ));
            let time_read = time_read.assume_init();
            (ret, time_read)
        }
    }

    #[doc(alias = "g_unix_mount_for")]
    #[doc(alias = "new_for")]
    pub fn for_file_path<P: AsRef<std::path::Path>>(file_path: P) -> (Option<UnixMountEntry>, u64) {
        unsafe {
            let mut time_read = mem::MaybeUninit::uninit();
            let ret = from_glib_full(ffi::g_unix_mount_for(
                file_path.as_ref().to_glib_none().0,
                time_read.as_mut_ptr(),
            ));
            let time_read = time_read.assume_init();
            (ret, time_read)
        }
    }

    #[doc(alias = "g_unix_mounts_get")]
    #[doc(alias = "get_mounts")]
    pub fn mounts() -> (Vec<UnixMountEntry>, u64) {
        unsafe {
            let mut time_read = mem::MaybeUninit::uninit();
            let ret = FromGlibPtrContainer::from_glib_full(ffi::g_unix_mounts_get(
                time_read.as_mut_ptr(),
            ));
            let time_read = time_read.assume_init();
            (ret, time_read)
        }
    }

    #[doc(alias = "g_unix_mount_compare")]
    pub fn compare(&self, mount2: &UnixMountEntry) -> i32 {
        unsafe {
            ffi::g_unix_mount_compare(
                mut_override(self.to_glib_none().0),
                mut_override(mount2.to_glib_none().0),
            )
        }
    }

    #[doc(alias = "g_unix_mount_get_device_path")]
    #[doc(alias = "get_device_path")]
    pub fn device_path(&self) -> std::path::PathBuf {
        unsafe {
            from_glib_none(ffi::g_unix_mount_get_device_path(mut_override(
                self.to_glib_none().0,
            )))
        }
    }

    #[doc(alias = "g_unix_mount_get_fs_type")]
    #[doc(alias = "get_fs_type")]
    pub fn fs_type(&self) -> GString {
        unsafe {
            from_glib_none(ffi::g_unix_mount_get_fs_type(mut_override(
                self.to_glib_none().0,
            )))
        }
    }

    #[doc(alias = "g_unix_mount_get_mount_path")]
    pub fn unix_mount_get_mount_path(&self) -> std::path::PathBuf {
        unsafe {
            from_glib_none(ffi::g_unix_mount_get_mount_path(mut_override(
                self.to_glib_none().0,
            )))
        }
    }

    #[cfg(feature = "v2_58")]
    #[cfg_attr(docsrs, doc(cfg(feature = "v2_58")))]
    #[doc(alias = "g_unix_mount_get_options")]
    #[doc(alias = "get_options")]
    pub fn options(&self) -> Option<GString> {
        unsafe {
            from_glib_none(ffi::g_unix_mount_get_options(mut_override(
                self.to_glib_none().0,
            )))
        }
    }

    #[cfg(feature = "v2_60")]
    #[cfg_attr(docsrs, doc(cfg(feature = "v2_60")))]
    #[doc(alias = "g_unix_mount_get_root_path")]
    #[doc(alias = "get_root_path")]
    pub fn root_path(&self) -> Option<std::path::PathBuf> {
        unsafe {
            from_glib_none(ffi::g_unix_mount_get_root_path(mut_override(
                self.to_glib_none().0,
            )))
        }
    }

    #[doc(alias = "g_unix_mount_guess_can_eject")]
    pub fn guess_can_eject(&self) -> bool {
        unsafe {
            from_glib(ffi::g_unix_mount_guess_can_eject(mut_override(
                self.to_glib_none().0,
            )))
        }
    }

    #[doc(alias = "g_unix_mount_guess_icon")]
    pub fn guess_icon(&self) -> Icon {
        unsafe {
            from_glib_full(ffi::g_unix_mount_guess_icon(mut_override(
                self.to_glib_none().0,
            )))
        }
    }

    #[doc(alias = "g_unix_mount_guess_name")]
    pub fn guess_name(&self) -> GString {
        unsafe {
            from_glib_full(ffi::g_unix_mount_guess_name(mut_override(
                self.to_glib_none().0,
            )))
        }
    }

    #[doc(alias = "g_unix_mount_guess_should_display")]
    pub fn guess_should_display(&self) -> bool {
        unsafe {
            from_glib(ffi::g_unix_mount_guess_should_display(mut_override(
                self.to_glib_none().0,
            )))
        }
    }

    #[doc(alias = "g_unix_mount_guess_symbolic_icon")]
    pub fn guess_symbolic_icon(&self) -> Icon {
        unsafe {
            from_glib_full(ffi::g_unix_mount_guess_symbolic_icon(mut_override(
                self.to_glib_none().0,
            )))
        }
    }

    #[doc(alias = "g_unix_mount_is_readonly")]
    pub fn is_readonly(&self) -> bool {
        unsafe {
            from_glib(ffi::g_unix_mount_is_readonly(mut_override(
                self.to_glib_none().0,
            )))
        }
    }

    #[doc(alias = "g_unix_mount_is_system_internal")]
    pub fn is_system_internal(&self) -> bool {
        unsafe {
            from_glib(ffi::g_unix_mount_is_system_internal(mut_override(
                self.to_glib_none().0,
            )))
        }
    }

    #[doc(alias = "g_unix_mounts_changed_since")]
    pub fn is_changed_since(time: u64) -> bool {
        unsafe { from_glib(ffi::g_unix_mounts_changed_since(time)) }
    }
}

impl PartialEq for UnixMountEntry {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.compare(other) == 0
    }
}

impl Eq for UnixMountEntry {}

impl PartialOrd for UnixMountEntry {
    #[inline]
    fn partial_cmp(&self, other: &Self) -> Option<cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for UnixMountEntry {
    #[inline]
    fn cmp(&self, other: &Self) -> cmp::Ordering {
        self.compare(other).cmp(&0)
    }
}
