// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;
use glib::GString;
use std::mem;
use std::ptr;

#[derive(Copy, Clone, PartialEq, Eq)]
#[doc(alias = "GdkAtom")]
pub struct Atom(ffi::GdkAtom);

pub const NONE: Atom = Atom(0 as *mut _);
pub const SELECTION_PRIMARY: Atom = Atom(1 as *mut _);
pub const SELECTION_SECONDARY: Atom = Atom(2 as *mut _);
pub const SELECTION_CLIPBOARD: Atom = Atom(69 as *mut _);
pub const TARGET_BITMAP: Atom = Atom(5 as *mut _);
pub const TARGET_COLORMAP: Atom = Atom(7 as *mut _);
pub const TARGET_DRAWABLE: Atom = Atom(17 as *mut _);
pub const TARGET_PIXMAP: Atom = Atom(20 as *mut _);
pub const TARGET_STRING: Atom = Atom(31 as *mut _);
pub const SELECTION_TYPE_ATOM: Atom = Atom(4 as *mut _);
pub const SELECTION_TYPE_BITMAP: Atom = Atom(5 as *mut _);
pub const SELECTION_TYPE_COLORMAP: Atom = Atom(7 as *mut _);
pub const SELECTION_TYPE_DRAWABLE: Atom = Atom(17 as *mut _);
pub const SELECTION_TYPE_INTEGER: Atom = Atom(19 as *mut _);
pub const SELECTION_TYPE_PIXMAP: Atom = Atom(20 as *mut _);
pub const SELECTION_TYPE_WINDOW: Atom = Atom(33 as *mut _);
pub const SELECTION_TYPE_STRING: Atom = Atom(31 as *mut _);

impl Atom {
    #[doc(alias = "gdk_atom_intern")]
    pub fn intern(atom_name: &str) -> Atom {
        assert_initialized_main_thread!();
        unsafe {
            Atom(ffi::gdk_atom_intern(
                atom_name.to_glib_none().0,
                false.into_glib(),
            ))
        }
    }

    #[doc(alias = "gdk_atom_name")]
    pub fn name(self) -> GString {
        unsafe { from_glib_full(ffi::gdk_atom_name(self.0)) }
    }

    pub fn value(self) -> usize {
        self.0 as usize
    }
}

impl GlibPtrDefault for Atom {
    type GlibType = ffi::GdkAtom;
}

unsafe impl glib::translate::TransparentPtrType for Atom {}

#[doc(hidden)]
impl Uninitialized for Atom {
    #[inline]
    unsafe fn uninitialized() -> Self {
        mem::zeroed()
    }
}

impl<'a> ToGlibPtr<'a, ffi::GdkAtom> for Atom {
    type Storage = ();

    #[inline]
    fn to_glib_none(&self) -> Stash<'a, ffi::GdkAtom, Atom> {
        Stash(self.0, ())
    }
}

impl<'a> ToGlibPtrMut<'a, *mut ffi::GdkAtom> for Atom {
    type Storage = ();

    #[inline]
    fn to_glib_none_mut(&'a mut self) -> StashMut<'a, *mut ffi::GdkAtom, Atom> {
        StashMut(&mut self.0, ())
    }
}

impl<'a> ToGlibContainerFromSlice<'a, *mut ffi::GdkAtom> for Atom {
    type Storage = (
        Vec<Stash<'a, ffi::GdkAtom, Atom>>,
        Option<Vec<ffi::GdkAtom>>,
    );

    fn to_glib_none_from_slice(t: &'a [Atom]) -> (*mut ffi::GdkAtom, Self::Storage) {
        skip_assert_initialized!();

        let v: Vec<_> = t.iter().map(|s| s.to_glib_none()).collect();
        let mut v_ptr: Vec<_> = v.iter().map(|s| s.0).collect();
        v_ptr.push(ptr::null_mut());

        (v_ptr.as_ptr() as *mut ffi::GdkAtom, (v, Some(v_ptr)))
    }

    fn to_glib_container_from_slice(t: &'a [Atom]) -> (*mut ffi::GdkAtom, Self::Storage) {
        skip_assert_initialized!();

        let v: Vec<_> = t.iter().map(|s| s.to_glib_none()).collect();

        let v_ptr = unsafe {
            let v_ptr = glib::ffi::g_malloc0(mem::size_of::<ffi::GdkAtom>() * (t.len() + 1))
                as *mut ffi::GdkAtom;

            for (i, s) in v.iter().enumerate() {
                ptr::write(v_ptr.add(i), s.0);
            }

            v_ptr
        };

        (v_ptr, (v, None))
    }

    fn to_glib_full_from_slice(_: &[Atom]) -> *mut ffi::GdkAtom {
        skip_assert_initialized!();

        unimplemented!()
    }
}

impl<'a> ToGlibContainerFromSlice<'a, *const ffi::GdkAtom> for Atom {
    type Storage = (
        Vec<Stash<'a, ffi::GdkAtom, Atom>>,
        Option<Vec<ffi::GdkAtom>>,
    );

    fn to_glib_none_from_slice(t: &'a [Atom]) -> (*const ffi::GdkAtom, Self::Storage) {
        skip_assert_initialized!();

        let v: Vec<_> = t.iter().map(|s| s.to_glib_none()).collect();
        let mut v_ptr: Vec<_> = v.iter().map(|s| s.0).collect();
        v_ptr.push(ptr::null_mut());

        (v_ptr.as_ptr() as *const ffi::GdkAtom, (v, Some(v_ptr)))
    }

    fn to_glib_container_from_slice(t: &'a [Atom]) -> (*const ffi::GdkAtom, Self::Storage) {
        skip_assert_initialized!();

        let v: Vec<_> = t.iter().map(|s| s.to_glib_none()).collect();

        let v_ptr = unsafe {
            let v_ptr = glib::ffi::g_malloc0(mem::size_of::<ffi::GdkAtom>() * (t.len() + 1))
                as *mut ffi::GdkAtom;

            for (i, s) in v.iter().enumerate() {
                ptr::write(v_ptr.add(i), s.0);
            }

            v_ptr as *const ffi::GdkAtom
        };

        (v_ptr, (v, None))
    }

    fn to_glib_full_from_slice(_: &[Atom]) -> *const ffi::GdkAtom {
        skip_assert_initialized!();

        unimplemented!()
    }
}

impl FromGlibPtrNone<ffi::GdkAtom> for Atom {
    #[inline]
    unsafe fn from_glib_none(ptr: ffi::GdkAtom) -> Atom {
        Atom(ptr)
    }
}

impl FromGlibPtrBorrow<ffi::GdkAtom> for Atom {
    #[inline]
    unsafe fn from_glib_borrow(ptr: ffi::GdkAtom) -> glib::translate::Borrowed<Atom> {
        glib::translate::Borrowed::new(Atom(ptr))
    }
}

impl FromGlibPtrFull<ffi::GdkAtom> for Atom {
    #[inline]
    unsafe fn from_glib_full(_: ffi::GdkAtom) -> Atom {
        unimplemented!()
    }
}

impl FromGlibContainerAsVec<ffi::GdkAtom, *mut ffi::GdkAtom> for Atom {
    unsafe fn from_glib_none_num_as_vec(ptr: *mut ffi::GdkAtom, num: usize) -> Vec<Self> {
        if num == 0 || ptr.is_null() {
            return Vec::new();
        }

        let mut res = Vec::with_capacity(num);
        for i in 0..num {
            res.push(from_glib_none(ptr::read(ptr.add(i))));
        }
        res
    }

    unsafe fn from_glib_container_num_as_vec(ptr: *mut ffi::GdkAtom, num: usize) -> Vec<Self> {
        let res = FromGlibContainerAsVec::from_glib_none_num_as_vec(ptr, num);
        glib::ffi::g_free(ptr as *mut _);
        res
    }

    unsafe fn from_glib_full_num_as_vec(ptr: *mut ffi::GdkAtom, num: usize) -> Vec<Self> {
        if num == 0 || ptr.is_null() {
            return Vec::new();
        }

        let mut res = Vec::with_capacity(num);
        for i in 0..num {
            res.push(from_glib_full(ptr::read(ptr.add(i))));
        }
        glib::ffi::g_free(ptr as *mut _);
        res
    }
}

impl FromGlibPtrArrayContainerAsVec<ffi::GdkAtom, *mut ffi::GdkAtom> for Atom {
    unsafe fn from_glib_none_as_vec(ptr: *mut ffi::GdkAtom) -> Vec<Self> {
        FromGlibContainerAsVec::from_glib_none_num_as_vec(ptr, c_ptr_array_len(ptr))
    }

    unsafe fn from_glib_container_as_vec(ptr: *mut ffi::GdkAtom) -> Vec<Self> {
        FromGlibContainerAsVec::from_glib_container_num_as_vec(ptr, c_ptr_array_len(ptr))
    }

    unsafe fn from_glib_full_as_vec(ptr: *mut ffi::GdkAtom) -> Vec<Self> {
        FromGlibContainerAsVec::from_glib_full_num_as_vec(ptr, c_ptr_array_len(ptr))
    }
}

impl<'a> From<&'a str> for Atom {
    fn from(r: &'a str) -> Atom {
        skip_assert_initialized!();
        Atom::intern(r)
    }
}
