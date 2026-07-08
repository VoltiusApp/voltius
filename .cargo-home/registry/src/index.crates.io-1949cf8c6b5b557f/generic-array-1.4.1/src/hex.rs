//! Generic array are commonly used as a return value for hash digests, so
//! it's a good idea to allow to hexlify them easily. This module implements
//! `std::fmt::LowerHex` and `std::fmt::UpperHex` traits.
//!
//! Example:
//!
//! ```rust
//! use generic_array::arr;
//! use generic_array::typenum;
//!
//! let array = arr![10u8, 20, 30];
//! assert_eq!(format!("{:x}", array), "0a141e");
//! ```

use core::{cmp::min, fmt, ops::Add, str};

use typenum::*;

use crate::{ArrayLength, GenericArray};

#[inline(always)]
fn hex_encode_fallback<const UPPER: bool>(src: &[u8], dst: &mut [u8]) {
    if dst.len() < src.len() * 2 {
        unsafe { core::hint::unreachable_unchecked() };
    }

    let alphabet = match UPPER {
        true => b"0123456789ABCDEF",
        false => b"0123456789abcdef",
    };

    dst.chunks_exact_mut(2).zip(src).for_each(|(s, c)| {
        s[0] = alphabet[(c >> 4) as usize];
        s[1] = alphabet[(c & 0xF) as usize];
    });
}

#[inline]
fn hex_encode<const UPPER: bool>(src: &[u8], dst: &mut [u8]) {
    debug_assert!(dst.len() >= (src.len() * 2));

    #[cfg(any(miri, not(feature = "faster-hex")))]
    hex_encode_fallback::<UPPER>(src, dst);

    // the `unwrap_unchecked` is to avoid the length checks
    #[cfg(all(feature = "faster-hex", not(miri)))]
    match UPPER {
        true => unsafe { faster_hex::hex_encode_upper(src, dst).unwrap_unchecked() },
        false => unsafe { faster_hex::hex_encode(src, dst).unwrap_unchecked() },
    };
}

fn generic_hex<N, const UPPER: bool>(
    arr: &GenericArray<u8, N>,
    f: &mut fmt::Formatter<'_>,
) -> fmt::Result
where
    N: ArrayLength + Add<N>,
    Sum<N, N>: ArrayLength,
{
    let max_digits = N::USIZE * 2;
    let max_digits = match f.precision() {
        Some(precision) if precision < max_digits => precision,
        _ => max_digits,
    };

    // ceil(max_digits / 2)
    let max_bytes = (max_digits >> 1) + (max_digits & 1);

    let input = {
        // LLVM can't seem to automatically prove this
        if max_bytes > N::USIZE {
            unsafe { core::hint::unreachable_unchecked() };
        }

        &arr[..max_bytes]
    };

    if N::USIZE <= 1024 {
        // For small arrays use a stack allocated buffer of 2x number of bytes
        let mut buf = GenericArray::<u8, Sum<N, N>>::default();

        if N::USIZE < 16 {
            // for the smallest inputs, don't bother limiting to max_bytes,
            // just process the entire array. When "faster-hex" is enabled,
            // this avoids its logic that winds up going to the fallback anyway
            hex_encode_fallback::<UPPER>(arr, &mut buf);
        } else {
            hex_encode::<UPPER>(input, &mut buf);
        }

        f.write_str(unsafe { str::from_utf8_unchecked(buf.get_unchecked(..max_digits)) })?;
    } else {
        // For large array use chunks of up to 1024 bytes (2048 hex chars)
        let mut buf = [0u8; 2048];
        let mut digits_left = max_digits;

        for chunk in input.chunks(1024) {
            hex_encode::<UPPER>(chunk, &mut buf);

            let n = min(chunk.len() * 2, digits_left);
            // SAFETY: n will always be within bounds due to the above min
            f.write_str(unsafe { str::from_utf8_unchecked(buf.get_unchecked(..n)) })?;
            digits_left -= n;
        }
    }
    Ok(())
}

impl<N: ArrayLength> fmt::LowerHex for GenericArray<u8, N>
where
    N: Add<N>,
    Sum<N, N>: ArrayLength,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        generic_hex::<_, false>(self, f)
    }
}

impl<N: ArrayLength> fmt::UpperHex for GenericArray<u8, N>
where
    N: Add<N>,
    Sum<N, N>: ArrayLength,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        generic_hex::<_, true>(self, f)
    }
}
