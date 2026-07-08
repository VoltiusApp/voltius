use std::ptr::NonNull;
use std::{cmp, slice};

/// A newtype wrapper for a little endian `u64`.
///
/// It is safe to transmute between a `u64` and `U64Le`.
#[repr(transparent)]
#[derive(Clone, Copy)]
pub(crate) struct U64Le(u64);

impl U64Le {
    /// Returns a `u64` with correct endianness for the target.
    ///
    /// On little endian targets, this is a no-op.
    #[allow(clippy::inline_always)]
    #[inline(always)]
    pub const fn get(self) -> u64 {
        u64::from_le(self.0)
    }
}

/// Splits a buffer into three subslices:
/// - the first one is up to the first 8-byte aligned address.
/// - the second one is 8-byte aligned and its length is a multiple of 8.
/// - the third one is 8-byte aligned but its length is less than 8.
pub(crate) fn split(buffer: &[u8]) -> (&[u8], &[U64Le], &[u8]) {
    let (start, mid) = {
        let split_index = {
            let addr = buffer.as_ptr() as usize;

            // Align to multiples of 8.
            let aligned_addr = (addr + 7) & (!7);

            // Index of the next aligned element.
            let next_i = aligned_addr - addr;

            // Buffer might be too small.
            cmp::min(next_i, buffer.len())
        };

        buffer.split_at(split_index)
    };

    let (mid, end) = {
        // Round length down to multiples of 8.
        let split_index = mid.len() & (!7);

        mid.split_at(split_index)
    };

    let mid = unsafe {
        let length = mid.len() / 8;
        let ptr = if length == 0 {
            // `slice::from_raw_parts` requires that pointers be nonnull and
            // aligned even for zero-length slices.
            NonNull::<U64Le>::dangling().as_ptr()
        } else {
            #[allow(clippy::cast_ptr_alignment)]
            mid.as_ptr().cast::<U64Le>()
        };

        slice::from_raw_parts(ptr, length)
    };

    (start, mid, end)
}
