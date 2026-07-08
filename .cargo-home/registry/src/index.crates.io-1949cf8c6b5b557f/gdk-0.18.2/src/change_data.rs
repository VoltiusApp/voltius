// Take a look at the license at the top of the repository in the LICENSE file.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChangeData<'a> {
    UChars(&'a [u8]),
    UShorts(&'a [u16]),
    ULongs(&'a [libc::c_ulong]),
    UChar(u8),
    UShort(u16),
    ULong(libc::c_ulong),
}

#[doc(hidden)]
impl<'a> ChangeData<'a> {
    pub fn to_glib(&self) -> *const u8 {
        match *self {
            Self::UChars(d) => d.as_ptr() as *const _,
            Self::UShorts(d) => d.as_ptr() as *const _,
            Self::ULongs(d) => d.as_ptr() as *const _,
            Self::UChar(d) => &d as *const _ as *const _,
            Self::UShort(d) => &d as *const _ as *const _,
            Self::ULong(d) => &d as *const _ as *const _,
        }
    }

    pub fn len(&self) -> usize {
        match *self {
            Self::UChars(d) => d.len(),
            Self::UShorts(d) => d.len(),
            Self::ULongs(d) => d.len(),
            Self::UChar(_) | Self::UShort(_) | Self::ULong(_) => 1,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() != 0
    }
}
