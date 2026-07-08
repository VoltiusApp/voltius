// Take a look at the license at the top of the repository in the LICENSE file.

use crate::FileFilterFlags;
use glib::translate::*;
use std::ffi::CStr;

#[repr(transparent)]
#[doc(alias = "GtkFileFilterInfo")]
pub struct FileFilterInfo(ffi::GtkFileFilterInfo);

impl FileFilterInfo {
    pub fn new(
        filename: Option<&str>,
        uri: Option<&str>,
        display_name: Option<&str>,
        mime_type: Option<&str>,
    ) -> Self {
        skip_assert_initialized!();
        let mut contains = FileFilterFlags::empty();
        for (value, bit) in [
            (filename, FileFilterFlags::FILENAME),
            (uri, FileFilterFlags::URI),
            (display_name, FileFilterFlags::DISPLAY_NAME),
            (mime_type, FileFilterFlags::MIME_TYPE),
        ] {
            if value.is_some() {
                contains |= bit;
            }
        }

        Self(ffi::GtkFileFilterInfo {
            contains: contains.bits(),
            filename: filename.to_glib_full(),
            uri: uri.to_glib_full(),
            display_name: display_name.to_glib_full(),
            mime_type: mime_type.to_glib_full(),
        })
    }

    #[doc(alias = "get_contains")]
    pub fn contains(&self) -> FileFilterFlags {
        FileFilterFlags::from_bits_truncate(self.0.contains)
    }

    #[doc(alias = "get_filename")]
    pub fn filename(&self) -> Option<&str> {
        unsafe {
            if self.0.filename.is_null() {
                None
            } else {
                Some(
                    CStr::from_ptr(self.0.filename)
                        .to_str()
                        .expect("filename was not valid UTF-8"),
                )
            }
        }
    }

    #[doc(alias = "get_uri")]
    pub fn uri(&self) -> Option<&str> {
        unsafe {
            if self.0.uri.is_null() {
                None
            } else {
                Some(
                    CStr::from_ptr(self.0.uri)
                        .to_str()
                        .expect("uri was not valid UTF-8"),
                )
            }
        }
    }

    #[doc(alias = "get_display_name")]
    pub fn display_name(&self) -> Option<&str> {
        unsafe {
            if self.0.display_name.is_null() {
                None
            } else {
                Some(
                    CStr::from_ptr(self.0.display_name)
                        .to_str()
                        .expect("display_name was not valid UTF-8"),
                )
            }
        }
    }

    #[doc(alias = "get_mime_type")]
    pub fn mime_type(&self) -> Option<&str> {
        unsafe {
            if self.0.mime_type.is_null() {
                None
            } else {
                Some(
                    CStr::from_ptr(self.0.mime_type)
                        .to_str()
                        .expect("mime_type was not valid UTF-8"),
                )
            }
        }
    }
}

impl Drop for FileFilterInfo {
    fn drop(&mut self) {
        for ptr in [
            self.0.filename,
            self.0.uri,
            self.0.display_name,
            self.0.mime_type,
        ] {
            unsafe {
                glib::ffi::g_free(ptr as *mut _);
            }
        }
    }
}

#[doc(hidden)]
impl FromGlibPtrNone<*const ffi::GtkFileFilterInfo> for FileFilterInfo {
    unsafe fn from_glib_none(ptr: *const ffi::GtkFileFilterInfo) -> Self {
        assert!(!ptr.is_null());
        Self(ffi::GtkFileFilterInfo {
            contains: (*ptr).contains,
            filename: glib::ffi::g_strdup((*ptr).filename),
            uri: glib::ffi::g_strdup((*ptr).uri),
            display_name: glib::ffi::g_strdup((*ptr).display_name),
            mime_type: glib::ffi::g_strdup((*ptr).mime_type),
        })
    }
}

#[doc(hidden)]
impl FromGlibPtrBorrow<*const ffi::GtkFileFilterInfo> for FileFilterInfo {
    unsafe fn from_glib_borrow(ptr: *const ffi::GtkFileFilterInfo) -> Borrowed<Self> {
        assert!(!ptr.is_null());
        Borrowed::new(FileFilterInfo(*ptr))
    }
}

#[doc(hidden)]
impl<'a> ToGlibPtr<'a, *const ffi::GtkFileFilterInfo> for FileFilterInfo {
    type Storage = (ffi::GtkFileFilterInfo, &'a FileFilterInfo);

    #[inline]
    fn to_glib_none(&'a self) -> Stash<'a, *const ffi::GtkFileFilterInfo, Self> {
        Stash(&self.0, (self.0, self))
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::TEST_THREAD_WORKER;

    const TEST_FILENAME: &str = "testfile.txt";
    const TEST_URI: &str = "file:///foo/bar/testfile.txt";
    const TEST_DISPLAY_NAME: &str = "testfile";
    const TEST_MIME_TYPE: &str = "text/plain";

    #[test]
    fn custom_filter() {
        TEST_THREAD_WORKER
            .push(|| {
                let _ = crate::init();

                let filter = crate::FileFilter::new();
                filter.add_custom(FileFilterFlags::all(), |filter_info| {
                    assert_eq![filter_info.filename(), Some(TEST_FILENAME)];
                    assert_eq![filter_info.uri(), Some(TEST_URI)];
                    assert_eq![filter_info.display_name(), Some(TEST_DISPLAY_NAME)];
                    assert_eq![filter_info.mime_type(), Some(TEST_MIME_TYPE)];
                    true
                });

                let filter_info = FileFilterInfo::new(
                    Some(TEST_FILENAME),
                    Some(TEST_URI),
                    Some(TEST_DISPLAY_NAME),
                    Some(TEST_MIME_TYPE),
                );
                filter.filter(&filter_info);
            })
            .expect("Failed to schedule a test call");
        while TEST_THREAD_WORKER.unprocessed() > 0 {}
    }
}
