//! Const-friendly decoding/encoding operations for [`Uint`].

#[cfg(all(feature = "der", feature = "hybrid-array"))]
mod der;
#[cfg(feature = "rlp")]
mod rlp;

use super::Uint;
use crate::{DecodeError, EncodedSize, Encoding, Limb, Word};
use core::{fmt, ops::Deref};

#[cfg(feature = "alloc")]
use crate::{Choice, NonZero, Reciprocal, UintRef, WideWord};
#[cfg(feature = "alloc")]
use alloc::{string::String, vec::Vec};

#[cfg(feature = "alloc")]
const RADIX_ENCODING_LIMBS_LARGE: usize = 16;
#[cfg(feature = "alloc")]
const RADIX_ENCODING_THRESHOLD_LARGE: usize = 24;

const RADIX_ENCODING_MIN: u32 = 2;
const RADIX_ENCODING_MAX: u32 = 36;

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Create a new [`Uint`] from the provided big endian bytes.
    ///
    /// # Panics
    /// - If the supplied byte slice is the incorrect size
    #[must_use]
    pub const fn from_be_slice(bytes: &[u8]) -> Self {
        assert!(
            bytes.len() == Limb::BYTES * LIMBS,
            "bytes are not the expected size"
        );

        let mut res = [Limb::ZERO; LIMBS];
        let mut buf = [0u8; Limb::BYTES];
        let mut i = 0;

        while i < LIMBS {
            let mut j = 0;
            while j < Limb::BYTES {
                buf[j] = bytes[i * Limb::BYTES + j];
                j += 1;
            }
            res[LIMBS - i - 1] = Limb(Word::from_be_bytes(buf));
            i += 1;
        }

        Uint::new(res)
    }

    /// Create a new [`Uint`] from the provided big endian hex string.
    ///
    /// # Panics
    /// - if the hex is malformed or not zero-padded accordingly for the size.
    #[must_use]
    pub const fn from_be_hex(hex: &str) -> Self {
        let bytes = hex.as_bytes();

        assert!(
            bytes.len() == Limb::BYTES * LIMBS * 2,
            "hex string is not the expected size"
        );

        let mut res = [Limb::ZERO; LIMBS];
        let mut buf = [0u8; Limb::BYTES];
        let mut i = 0;
        let mut err = 0;

        while i < LIMBS {
            let mut j = 0;
            while j < Limb::BYTES {
                let offset = (i * Limb::BYTES + j) * 2;
                let (result, byte_err) = decode_hex_byte([bytes[offset], bytes[offset + 1]]);
                err |= byte_err;
                buf[j] = result;
                j += 1;
            }
            res[LIMBS - i - 1] = Limb(Word::from_be_bytes(buf));
            i += 1;
        }

        assert!(err == 0, "invalid hex byte");

        Uint::new(res)
    }

    /// Create a new [`Uint`] from the provided little endian bytes.
    ///
    /// # Panics
    /// - If the supplied byte slice is the incorrect size
    #[must_use]
    pub const fn from_le_slice(bytes: &[u8]) -> Self {
        assert!(
            bytes.len() == Limb::BYTES * LIMBS,
            "bytes are not the expected size"
        );

        let mut res = [Limb::ZERO; LIMBS];
        let mut buf = [0u8; Limb::BYTES];
        let mut i = 0;

        while i < LIMBS {
            let mut j = 0;
            while j < Limb::BYTES {
                buf[j] = bytes[i * Limb::BYTES + j];
                j += 1;
            }
            res[i] = Limb(Word::from_le_bytes(buf));
            i += 1;
        }

        Uint::new(res)
    }

    /// Create a new [`Uint`] from the provided little endian hex string.
    ///
    /// # Panics
    /// - if the hex is malformed or not zero-padded accordingly for the size.
    #[must_use]
    pub const fn from_le_hex(hex: &str) -> Self {
        let bytes = hex.as_bytes();

        assert!(
            bytes.len() == Limb::BYTES * LIMBS * 2,
            "bytes are not the expected size"
        );

        let mut res = [Limb::ZERO; LIMBS];
        let mut buf = [0u8; Limb::BYTES];
        let mut i = 0;
        let mut err = 0;

        while i < LIMBS {
            let mut j = 0;
            while j < Limb::BYTES {
                let offset = (i * Limb::BYTES + j) * 2;
                let (result, byte_err) = decode_hex_byte([bytes[offset], bytes[offset + 1]]);
                err |= byte_err;
                buf[j] = result;
                j += 1;
            }
            res[i] = Limb(Word::from_le_bytes(buf));
            i += 1;
        }

        assert!(err == 0, "invalid hex byte");

        Uint::new(res)
    }

    /// Serialize this [`Uint`] as big-endian, writing it into the provided
    /// byte slice.
    #[cfg(feature = "hybrid-array")]
    #[inline]
    pub(crate) fn write_be_bytes(&self, out: &mut [u8]) {
        debug_assert_eq!(out.len(), Limb::BYTES * LIMBS);

        for (src, dst) in self
            .limbs
            .iter()
            .rev()
            .cloned()
            .zip(out.chunks_exact_mut(Limb::BYTES))
        {
            dst.copy_from_slice(&src.to_be_bytes());
        }
    }

    /// Serialize this [`Uint`] as little-endian, writing it into the provided
    /// byte slice.
    #[cfg(feature = "hybrid-array")]
    #[inline]
    pub(crate) fn write_le_bytes(&self, out: &mut [u8]) {
        debug_assert_eq!(out.len(), Limb::BYTES * LIMBS);

        for (src, dst) in self
            .limbs
            .iter()
            .cloned()
            .zip(out.chunks_exact_mut(Limb::BYTES))
        {
            dst.copy_from_slice(&src.to_le_bytes());
        }
    }

    /// Create a new [`Uint`] from a string slice in a given base.
    ///
    /// The string may begin with a `+` character, and may use
    /// underscore characters to separate digits.
    ///
    /// # Errors
    /// - Returns [`DecodeError::InputSize`] if the size of the decoded integer is larger than this
    ///   type can represent
    /// - Returns [`DecodeError::InvalidDigit`] if the input value contains non-digit characters or
    ///   digits outside of the range `0..radix`.
    ///
    /// # Panics
    /// - if `radix` is not in the range from 2 to 36.
    pub fn from_str_radix_vartime(src: &str, radix: u32) -> Result<Self, DecodeError> {
        let mut slf = Self::ZERO;
        radix_decode_str(src, radix, &mut SliceDecodeByLimb::new(&mut slf.limbs))?;
        Ok(slf)
    }

    /// Format a [`Uint`] as a string in a given base.
    ///
    /// # Panics
    /// - if `radix` is not in the range from 2 to 36.
    #[cfg(feature = "alloc")]
    #[must_use]
    pub fn to_string_radix_vartime(&self, radix: u32) -> String {
        let mut buf = *self;
        radix_encode_limbs_mut_to_string(radix, buf.as_mut_uint_ref())
    }

    /// Serialize as big endian bytes.
    #[must_use]
    pub const fn to_be_bytes(&self) -> EncodedUint<LIMBS> {
        EncodedUint::new_be(self)
    }

    /// Serialize as little endian bytes.
    #[must_use]
    pub const fn to_le_bytes(&self) -> EncodedUint<LIMBS> {
        EncodedUint::new_le(self)
    }
}

/// [`Uint`] encoded as bytes.
// Until const generic expressions are stable, we cannot statically declare a `u8` array
// of the size `LIMBS * Limb::BYTES`.
// So instead we use the array of words, and treat it as an array of bytes.
// It's a little hacky, but it works, because the array is guaranteed to be contiguous.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct EncodedUint<const LIMBS: usize>([Word; LIMBS]);

#[allow(unsafe_code)]
const fn cast_slice(limbs: &[Word]) -> &[u8] {
    let new_len = size_of_val(limbs);

    // SAFETY:
    // - `size_of_val` returns the size of `limbs` in bytes
    // - We are creating a new slice of the same size, but casting word to bytes, so we don't need
    //   to worry about alignment because bytes are always aligned
    unsafe { core::slice::from_raw_parts(limbs.as_ptr() as *mut u8, new_len) }
}

#[allow(unsafe_code)]
const fn cast_slice_mut(limbs: &mut [Word]) -> &mut [u8] {
    let new_len = size_of_val(limbs);

    // SAFETY:
    // - `size_of_val` returns the size of `limbs` in bytes
    // - We are creating a new slice of the same size, but casting word to bytes, so we don't need
    //   to worry about alignment because bytes are always aligned
    unsafe { core::slice::from_raw_parts_mut(limbs.as_mut_ptr().cast::<u8>(), new_len) }
}

impl<const LIMBS: usize> EncodedUint<LIMBS> {
    /// Extracts a byte slice containing the entire contents.
    #[must_use]
    pub const fn as_slice(&self) -> &[u8] {
        cast_slice(&self.0)
    }

    /// Extracts a mutable byte slice containing the entire contents.
    pub const fn as_mut_slice(&mut self) -> &mut [u8] {
        cast_slice_mut(&mut self.0)
    }

    const fn new_le(value: &Uint<LIMBS>) -> Self {
        let mut buffer = [0; LIMBS];
        let mut i = 0;

        while i < LIMBS {
            let src_bytes = &value.limbs[i].0.to_le_bytes();

            // We could cast the whole `buffer` to bytes at once,
            // but IndexMut does not work in const context.
            let dst_bytes: &mut [u8] = cast_slice_mut(core::slice::from_mut(&mut buffer[i]));

            // `copy_from_slice` can be used here when MSRV moves past 1.87
            let mut j = 0;
            while j < Limb::BYTES {
                dst_bytes[j] = src_bytes[j];
                j += 1;
            }

            i += 1;
        }
        Self(buffer)
    }

    const fn new_be(value: &Uint<LIMBS>) -> Self {
        let mut buffer = [0; LIMBS];
        let mut i = 0;
        while i < LIMBS {
            let src_bytes = &value.limbs[i].0.to_be_bytes();

            // We could cast the whole `buffer` to bytes at once,
            // but IndexMut does not work in const context.
            let dst_bytes: &mut [u8] =
                cast_slice_mut(core::slice::from_mut(&mut buffer[LIMBS - 1 - i]));

            // `copy_from_slice` can be used here when MSRV moves past 1.87
            let mut j = 0;
            while j < Limb::BYTES {
                dst_bytes[j] = src_bytes[j];
                j += 1;
            }

            i += 1;
        }
        Self(buffer)
    }
}

impl<const LIMBS: usize> Default for EncodedUint<LIMBS> {
    fn default() -> Self {
        Self([0; LIMBS])
    }
}

impl<const LIMBS: usize> AsRef<[u8]> for EncodedUint<LIMBS> {
    fn as_ref(&self) -> &[u8] {
        self.as_slice()
    }
}

impl<const LIMBS: usize> AsMut<[u8]> for EncodedUint<LIMBS> {
    fn as_mut(&mut self) -> &mut [u8] {
        self.as_mut_slice()
    }
}

impl<const LIMBS: usize> Deref for EncodedUint<LIMBS> {
    type Target = [u8];
    fn deref(&self) -> &Self::Target {
        self.as_ref()
    }
}

impl<const BYTES: usize, const LIMBS: usize> From<EncodedUint<LIMBS>> for [u8; BYTES]
where
    EncodedUint<LIMBS>: EncodedSize<Target = [u8; BYTES]>,
{
    #[inline]
    fn from(input: EncodedUint<LIMBS>) -> Self {
        Self::from(&input)
    }
}

impl<const BYTES: usize, const LIMBS: usize> From<&EncodedUint<LIMBS>> for [u8; BYTES]
where
    EncodedUint<LIMBS>: EncodedSize<Target = [u8; BYTES]>,
{
    #[inline]
    fn from(input: &EncodedUint<LIMBS>) -> Self {
        let mut output = [0u8; BYTES];
        output.as_mut_slice().copy_from_slice(input.as_ref());
        output
    }
}

impl<const BYTES: usize, const LIMBS: usize> From<[u8; BYTES]> for EncodedUint<LIMBS>
where
    [u8; BYTES]: EncodedSize<Target = EncodedUint<LIMBS>>,
{
    #[inline]
    fn from(input: [u8; BYTES]) -> Self {
        Self::from(&input)
    }
}

impl<const BYTES: usize, const LIMBS: usize> From<&[u8; BYTES]> for EncodedUint<LIMBS>
where
    [u8; BYTES]: EncodedSize<Target = EncodedUint<LIMBS>>,
{
    #[inline]
    fn from(input: &[u8; BYTES]) -> Self {
        let mut output = Self::default();
        output.as_mut().copy_from_slice(input.as_ref());
        output
    }
}

/// Returned if an object cannot be instantiated from the given byte slice.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TryFromSliceError;

impl fmt::Display for TryFromSliceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> Result<(), fmt::Error> {
        write!(f, "TryFromSliceError")
    }
}

impl core::error::Error for TryFromSliceError {}

impl<'a, const LIMBS: usize> TryFrom<&'a [u8]> for EncodedUint<LIMBS> {
    type Error = TryFromSliceError;

    fn try_from(bytes: &'a [u8]) -> Result<Self, Self::Error> {
        if bytes.len() != Uint::<LIMBS>::BYTES {
            return Err(TryFromSliceError);
        }
        let mut result = Self::default();
        result.as_mut().copy_from_slice(bytes);
        Ok(result)
    }
}

impl<const LIMBS: usize> Encoding for Uint<LIMBS> {
    type Repr = EncodedUint<LIMBS>;

    #[inline]
    fn from_be_bytes(bytes: Self::Repr) -> Self {
        Self::from_be_slice(bytes.as_ref())
    }

    #[inline]
    fn from_le_bytes(bytes: Self::Repr) -> Self {
        Self::from_le_slice(bytes.as_ref())
    }

    #[inline]
    fn to_be_bytes(&self) -> Self::Repr {
        self.to_be_bytes()
    }

    #[inline]
    fn to_le_bytes(&self) -> Self::Repr {
        self.to_le_bytes()
    }
}

/// Decode a single nibble of upper or lower hex
#[inline(always)]
#[allow(clippy::cast_sign_loss)]
const fn decode_nibble(src: u8) -> u16 {
    let byte = src as i16;
    let mut ret: i16 = -1;

    // 0-9  0x30-0x39
    // if (byte > 0x2f && byte < 0x3a) ret += byte - 0x30 + 1; // -47
    ret += (((0x2fi16 - byte) & (byte - 0x3a)) >> 8) & (byte - 47);
    // A-F  0x41-0x46
    // if (byte > 0x40 && byte < 0x47) ret += byte - 0x41 + 10 + 1; // -54
    ret += (((0x40i16 - byte) & (byte - 0x47)) >> 8) & (byte - 54);
    // a-f  0x61-0x66
    // if (byte > 0x60 && byte < 0x67) ret += byte - 0x61 + 10 + 1; // -86
    ret += (((0x60i16 - byte) & (byte - 0x67)) >> 8) & (byte - 86);

    ret as u16
}

/// Decode a single byte encoded as two hexadecimal characters.
/// Second element of the tuple is non-zero if the `bytes` values are not in the valid range
/// (0-9, a-z, A-Z).
#[inline(always)]
#[allow(clippy::cast_possible_truncation)]
pub(crate) const fn decode_hex_byte(bytes: [u8; 2]) -> (u8, u16) {
    let hi = decode_nibble(bytes[0]);
    let lo = decode_nibble(bytes[1]);
    let byte = (hi << 4) | lo;
    let err = byte >> 8;
    let result = byte as u8;
    (result, err)
}

/// Allow decoding of integers into fixed and variable-length types
pub(crate) trait DecodeByLimb {
    /// Access the limbs as a mutable slice
    fn limbs_mut(&mut self) -> &mut [Limb];

    /// Append a new most-significant limb
    fn push_limb(&mut self, limb: Limb) -> bool;
}

/// Wrap a `Limb` slice as a target for decoding
pub(crate) struct SliceDecodeByLimb<'de> {
    limbs: &'de mut [Limb],
    len: usize,
}

impl<'de> SliceDecodeByLimb<'de> {
    #[inline]
    pub fn new(limbs: &'de mut [Limb]) -> Self {
        Self { limbs, len: 0 }
    }
}

impl DecodeByLimb for SliceDecodeByLimb<'_> {
    #[inline]
    fn push_limb(&mut self, limb: Limb) -> bool {
        if self.len < self.limbs.len() {
            self.limbs[self.len] = limb;
            self.len += 1;
            true
        } else {
            false
        }
    }

    #[inline]
    fn limbs_mut(&mut self) -> &mut [Limb] {
        &mut self.limbs[..self.len]
    }
}

/// Decode an ascii string in base `radix`, writing the result to the `DecodeByLimb` instance `out`.
///
/// The input must be a non-empty ascii string, may begin with a `+` character, and may use `_` as a
/// separator between digits.
///
/// # Panics
/// - if `radix` is not within `RADIX_ENCODING_MIN..=RADIX_ENCODING_MAX`.
#[allow(clippy::cast_possible_truncation, clippy::panic_in_result_fn)]
pub(crate) fn radix_decode_str<D: DecodeByLimb>(
    src: &str,
    radix: u32,
    out: &mut D,
) -> Result<(), DecodeError> {
    assert!(
        (RADIX_ENCODING_MIN..=RADIX_ENCODING_MAX).contains(&radix),
        "unsupported radix"
    );
    if radix == 2 || radix == 4 || radix == 16 {
        radix_decode_str_aligned_digits(src, radix as u8, out)
    } else {
        radix_decode_str_digits(src, radix as u8, out)
    }
}

#[inline(always)]
/// Perform basic validation and pre-processing on a digit string
fn radix_preprocess_str(src: &str) -> Result<&[u8], DecodeError> {
    // Treat the input as ascii bytes
    let src_b = src.as_bytes();
    let mut digits = src_b.strip_prefix(b"+").unwrap_or(src_b);

    if digits.is_empty() {
        // Blank string or plain "+" not allowed
        Err(DecodeError::Empty)
    } else if digits.starts_with(b"_") || digits.ends_with(b"_") {
        // Leading or trailing underscore not allowed
        Err(DecodeError::InvalidDigit)
    } else {
        // Strip leading zeroes to simplify parsing
        while digits[0] == b'0' || digits[0] == b'_' {
            digits = &digits[1..];
            if digits.is_empty() {
                break;
            }
        }
        Ok(digits)
    }
}

/// Decode a string of digits in base `radix`
#[allow(clippy::cast_possible_truncation)]
fn radix_decode_str_digits<D: DecodeByLimb>(
    src: &str,
    radix: u8,
    out: &mut D,
) -> Result<(), DecodeError> {
    let digits = radix_preprocess_str(src)?;
    let mut buf = [0u8; Limb::BITS as _];
    let mut limb_digits = Word::MAX.ilog(radix.into()) as usize;
    let mut limb_max = Limb(Word::pow(radix.into(), limb_digits as _));
    let mut digits_pos = 0;
    let mut buf_pos = 0;

    while digits_pos < digits.len() {
        // Parse digits from most significant, to fill buffer limb
        loop {
            let digit = match digits[digits_pos] {
                b @ b'0'..=b'9' => b - b'0',
                b @ b'a'..=b'z' => b + 10 - b'a',
                b @ b'A'..=b'Z' => b + 10 - b'A',
                b'_' => {
                    digits_pos += 1;
                    continue;
                }
                _ => radix,
            };
            if digit >= radix {
                return Err(DecodeError::InvalidDigit);
            }
            buf[buf_pos] = digit;
            buf_pos += 1;
            digits_pos += 1;

            if digits_pos == digits.len() || buf_pos == limb_digits {
                break;
            }
        }

        // On the final loop, there may be fewer digits to process
        if buf_pos < limb_digits {
            limb_digits = buf_pos;
            limb_max = Limb(Word::pow(radix.into(), limb_digits as _));
        }

        // Combine the digit bytes into a limb
        let mut carry = Limb::ZERO;
        for c in buf[..limb_digits].iter().copied() {
            carry = Limb(carry.0 * Word::from(radix) + Word::from(c));
        }
        // Multiply the existing limbs by `radix` ^ `limb_digits`,
        // and add the new least-significant limb
        for limb in out.limbs_mut().iter_mut() {
            (*limb, carry) = limb.carrying_mul_add(limb_max, carry, Limb::ZERO);
        }
        // Append the new carried limb, if any
        if carry.0 != 0 && !out.push_limb(carry) {
            return Err(DecodeError::InputSize);
        }

        buf_pos = 0;
        buf[..limb_digits].fill(0);
    }

    Ok(())
}

/// Decode digits for bases where an integer number of characters
/// can represent a saturated Limb (specifically 2, 4, and 16).
#[allow(clippy::integer_division_remainder_used, reason = "needs triage")]
fn radix_decode_str_aligned_digits<D: DecodeByLimb>(
    src: &str,
    radix: u8,
    out: &mut D,
) -> Result<(), DecodeError> {
    debug_assert!(radix == 2 || radix == 4 || radix == 16);

    let digits = radix_preprocess_str(src)?;
    let shift = radix.trailing_zeros();
    let limb_digits = (Limb::BITS / shift) as usize;
    let mut buf = [0u8; Limb::BITS as _];
    let mut buf_pos = 0;
    let mut digits_pos = digits.len();

    while digits_pos > 0 {
        // Parse digits from the least significant, to fill the buffer limb
        loop {
            digits_pos -= 1;

            let digit = match digits[digits_pos] {
                b @ b'0'..=b'9' => b - b'0',
                b @ b'a'..=b'z' => b + 10 - b'a',
                b @ b'A'..=b'Z' => b + 10 - b'A',
                b'_' => {
                    // cannot occur when c == 0
                    continue;
                }
                _ => radix,
            };
            if digit >= radix {
                return Err(DecodeError::InvalidDigit);
            }
            buf[buf_pos] = digit;
            buf_pos += 1;

            if digits_pos == 0 || buf_pos == limb_digits {
                break;
            }
        }

        if buf_pos > 0 {
            // Combine the digit bytes into a limb
            let mut w: Word = 0;
            for c in buf[..buf_pos].iter().rev().copied() {
                w = (w << shift) | Word::from(c);
            }
            // Append the new most-significant limb
            if !out.push_limb(Limb(w)) {
                return Err(DecodeError::InputSize);
            }

            buf_pos = 0;
            buf[..limb_digits].fill(0);
        }
    }

    Ok(())
}

/// Encode a slice of limbs to a string in base `radix`. The result will have no leading
/// zeros unless the value itself is zero.
///
/// # Panics
/// - if `radix` is not in the range from 2 to 36.
#[cfg(feature = "alloc")]
pub(crate) fn radix_encode_limbs_to_string(radix: u32, limbs: &[Limb]) -> String {
    let mut array_buf = [Limb::ZERO; 128];
    let mut vec_buf = Vec::new();
    let limb_count = limbs.len();
    let buf = if limb_count <= array_buf.len() {
        array_buf[..limb_count].copy_from_slice(limbs);
        &mut array_buf[..limb_count]
    } else {
        vec_buf.extend_from_slice(limbs);
        &mut vec_buf[..limb_count]
    };
    radix_encode_limbs_mut_to_string(radix, UintRef::new_mut(buf))
}

/// Encode a slice of limbs to a string in base `radix`. The contents of the slice
/// will be used as a working buffer. The result will have no leading zeros unless
/// the value itself is zero.
///
/// # Panics
/// - if `radix` is not in the range from 2 to 36.
#[cfg(feature = "alloc")]
pub(crate) fn radix_encode_limbs_mut_to_string(radix: u32, limbs: &mut UintRef) -> String {
    assert!(
        (RADIX_ENCODING_MIN..=RADIX_ENCODING_MAX).contains(&radix),
        "unsupported radix"
    );

    let mut out;
    if radix.is_power_of_two() {
        let bits = radix.trailing_zeros() as usize;
        let size = (limbs.nlimbs() * Limb::BITS as usize).div_ceil(bits);
        out = vec![0u8; size];
        radix_encode_limbs_by_shifting(radix, limbs, &mut out[..]);
    } else {
        let params = RadixDivisionParams::for_radix(radix);
        let size = params.encoded_size(limbs.nlimbs());
        out = vec![0u8; size];
        params.encode_limbs(limbs, &mut out[..]);
    }
    let size = out.len();
    let mut skip = 0;
    while skip + 1 < size && out[skip] == b'0' {
        skip += 1;
    }
    if skip > 0 {
        out.copy_within(skip..size, 0);
        out.truncate(size - skip);
    }
    String::from_utf8(out).expect("utf-8 decoding error")
}

/// For `radix` values which are a power of two, encode the mutable limb slice to
/// the output buffer as ASCII characters in base `radix`. Leading zeros are added to
/// fill `out`. The slice `limbs` is used as a working buffer. Output will be truncated
/// if the provided buffer is too small.
#[cfg(feature = "alloc")]
#[allow(clippy::cast_possible_truncation, reason = "needs triage")]
#[allow(clippy::integer_division_remainder_used, reason = "needs triage")]
fn radix_encode_limbs_by_shifting(radix: u32, limbs: &UintRef, out: &mut [u8]) {
    debug_assert!(radix.is_power_of_two());
    debug_assert!(!out.is_empty());

    let radix_bits = radix.trailing_zeros();
    let mask = (radix - 1) as u8;
    let mut out_idx = out.len();
    let mut digits: WideWord = 0;
    let mut digits_bits = 0;
    let mut digit;

    for limb in limbs.iter().chain([&Limb::ZERO]) {
        digits_bits += Limb::BITS;
        digits |= WideWord::from(limb.0) << (digits_bits % Limb::BITS);
        for _ in 0..((digits_bits / radix_bits) as usize).min(out_idx) {
            out_idx -= 1;
            (digit, digits) = ((digits as u8) & mask, digits >> radix_bits);
            out[out_idx] = if digit < 10 {
                b'0' + digit
            } else {
                b'a' + (digit - 10)
            };
            digits_bits -= radix_bits;
        }
    }

    out[0..out_idx].fill(b'0');
}

/// Parameter set used to perform radix encoding by division.
#[cfg(feature = "alloc")]
#[derive(Debug, Clone, Copy)]
pub(crate) struct RadixDivisionParams {
    radix: u32,
    digits_per_limb: usize,
    bits_per_limb: u32,
    recip_limb: Reciprocal,
    digits_large: usize,
    div_large: [Limb; RADIX_ENCODING_LIMBS_LARGE],
    recip_large: Reciprocal,
    shift_large: u32,
}

#[cfg(feature = "alloc")]
impl RadixDivisionParams {
    // Generate all valid parameters ahead of time
    #[allow(trivial_numeric_casts)]
    const ALL: [Self; 31] = {
        let mut res = [Self {
            radix: 0,
            digits_per_limb: 0,
            bits_per_limb: 0,
            recip_limb: Reciprocal::default(),
            digits_large: 0,
            div_large: [Limb::ZERO; RADIX_ENCODING_LIMBS_LARGE],
            shift_large: 0,
            recip_large: Reciprocal::default(),
        }; 31];
        let mut radix: u32 = 3;
        let mut i: usize = 0;
        while radix <= RADIX_ENCODING_MAX {
            if radix.is_power_of_two() {
                radix += 1;
                continue;
            }
            let digits_limb = Word::MAX.ilog(radix as Word);
            let div_limb = NonZero(Limb((radix as Word).pow(digits_limb)));
            let bits_limb = Limb::BITS - div_limb.0.leading_zeros() - 1;
            let (div_large, digits_large, shift_large) =
                radix_large_divisor(radix, div_limb, digits_limb as usize);
            let recip_large = Reciprocal::new(
                div_large[RADIX_ENCODING_LIMBS_LARGE - 1]
                    .to_nz()
                    .expect_copied("zero divisor"),
            );
            res[i] = Self {
                radix,
                digits_per_limb: digits_limb as usize,
                bits_per_limb: bits_limb,
                recip_limb: Reciprocal::new(div_limb),
                digits_large,
                div_large,
                shift_large,
                recip_large,
            };
            radix += 1;
            i += 1;
        }
        res
    };

    #[allow(trivial_numeric_casts)]
    pub const fn for_radix(radix: u32) -> Self {
        assert!(
            !(radix < RADIX_ENCODING_MIN || radix > RADIX_ENCODING_MAX),
            "invalid radix for division"
        );
        let ret = Self::ALL[(radix + radix.leading_zeros() - 33) as usize];
        assert!(ret.radix == radix, "radix lookup failure");
        ret
    }

    /// Get the minimum size of the required output buffer for encoding a set of limbs.
    pub const fn encoded_size(&self, limb_count: usize) -> usize {
        // a slightly pessimistic estimate
        limb_count * (self.digits_per_limb + 1)
    }

    /// Encode the mutable limb slice to the output buffer as ASCII characters in base
    /// `radix`. Leading zeros are added to fill `out`. The slice `limbs` is used as a
    /// working buffer. Output will be truncated if the provided buffer is too small.
    #[allow(clippy::cast_possible_truncation)]
    pub fn encode_limbs(&self, mut limbs: &mut UintRef, out: &mut [u8]) {
        let mut out_idx = out.len();
        let mut remain = Uint::<RADIX_ENCODING_LIMBS_LARGE>::ZERO;

        while out_idx > 0 {
            let (digits, next_idx) = if limbs.nlimbs() >= RADIX_ENCODING_THRESHOLD_LARGE {
                let div_large = UintRef::new(&self.div_large);
                let remain_mut = remain.as_mut_uint_ref();

                // Divide by the large divisor
                let limbs_hi = limbs.shl_assign_limb_vartime(self.shift_large);
                let rem_high = limbs.div_rem_large_shifted(
                    limbs_hi,
                    div_large,
                    RADIX_ENCODING_LIMBS_LARGE as u32,
                    self.recip_large,
                    Choice::TRUE,
                );
                let limbs_rem;
                // At this point, the limbs at and above RADIX_ENCODING_LIMBS_LARGE represent
                // the quotient, and the limbs below (plus rem_high) represent the remainder
                (limbs_rem, limbs) = limbs.split_at_mut(RADIX_ENCODING_LIMBS_LARGE - 1);

                // Copy out the remainder
                remain_mut
                    .leading_mut(RADIX_ENCODING_LIMBS_LARGE - 1)
                    .copy_from(limbs_rem);
                remain_mut.limbs[RADIX_ENCODING_LIMBS_LARGE - 1] = rem_high;
                remain_mut.shr_assign_limb_vartime(self.shift_large);

                (remain_mut, out_idx.saturating_sub(self.digits_large))
            } else {
                (core::mem::replace(&mut limbs, UintRef::new_mut(&mut [])), 0)
            };

            // Encode the next batch of digits
            self.encode_limbs_small(digits, &mut out[next_idx..out_idx]);
            out_idx = next_idx;
        }
    }

    #[allow(trivial_numeric_casts, reason = "needs triage")]
    #[allow(clippy::cast_possible_truncation, reason = "needs triage")]
    #[allow(clippy::integer_division_remainder_used, reason = "needs triage")]
    fn encode_limbs_small(&self, mut limbs: &mut UintRef, out: &mut [u8]) {
        const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";

        let radix = Word::from(self.radix);
        let mut out_idx = out.len();
        let mut bits_acc = 0;
        let (mut digit, mut digits_word);

        while out_idx > 0 {
            if limbs.is_empty() {
                out[0..out_idx].fill(b'0');
                break;
            }

            // The remainder represents a digit in base `radix ** digits_per_limb`
            let limbs_hi = limbs.shl_assign_limb_vartime(self.recip_limb.shift());
            digits_word = limbs
                .div_rem_limb_with_reciprocal_shifted(limbs_hi, &self.recip_limb)
                .0;

            // Reduce the length of the input as we consume a limb's worth of bits (conservatively)
            bits_acc += self.bits_per_limb;
            if bits_acc >= Limb::BITS {
                bits_acc -= Limb::BITS;
                limbs = limbs.leading_mut(limbs.nlimbs().saturating_sub(1));
            }

            // Output the individual digits
            for _ in 0..self.digits_per_limb.min(out_idx) {
                out_idx -= 1;
                (digits_word, digit) = (digits_word / radix, (digits_word % radix) as usize);
                out[out_idx] = DIGITS[digit];
            }
        }
    }
}

/// Compute the maximum radix divisor for a number of limbs.
/// Returns a pair of the large divisor value and the number of digits,
/// such that `divisor = radix ** digits`. The value `div_limb` is the
/// largest power of `radix` that can fit within a limb.
#[cfg(feature = "alloc")]
#[allow(trivial_numeric_casts)]
const fn radix_large_divisor<const LIMBS: usize>(
    radix: u32,
    div_limb: NonZero<Limb>,
    digits_limb: usize,
) -> ([Limb; LIMBS], usize, u32) {
    let mut out = [Limb::ZERO; LIMBS];
    let mut digits_large = digits_limb;
    let mut top = 1;
    out[0] = div_limb.0;
    // Calculate largest power of div_limb (itself a power of radix)
    while top < LIMBS {
        let mut carry = Limb::ZERO;
        let mut j = 0;
        while j < top {
            (out[j], carry) = out[j].carrying_mul_add(div_limb.0, carry, Limb::ZERO);
            j += 1;
        }
        if carry.0 != 0 {
            out[top] = carry;
            top += 1;
        }
        digits_large += digits_limb;
    }
    // Multiply by radix while we can do so without overflowing
    let mut out_test = out;
    loop {
        let mut carry = Limb::ZERO;
        let mut j = 0;
        while j < LIMBS {
            (out_test[j], carry) = out[j].carrying_mul_add(Limb(radix as Word), carry, Limb::ZERO);
            j += 1;
        }
        if carry.0 == 0 {
            out = out_test;
            digits_large += 1;
        } else {
            break;
        }
    }

    let out_mut = UintRef::new_mut(&mut out);
    let shift = out_mut.leading_zeros();
    out_mut.shl_assign_limb_vartime(shift);
    (out, digits_large, shift)
}

#[cfg(test)]
mod tests {
    use crate::{DecodeError, EncodedUint, Limb, U64, U128};
    use hex_literal::hex;

    #[cfg(feature = "alloc")]
    use {
        super::{radix_encode_limbs_to_string, radix_large_divisor},
        crate::{NonZero, Uint, Word},
        alloc::format,
    };

    cpubits::cpubits! {
        32 => {
            use crate::U64 as UintEx;

            #[test]
            fn from_be_slice() {
                let bytes = hex!("0011223344556677");
                let n = UintEx::from_be_slice(&bytes);
                assert_eq!(n.as_limbs(), &[Limb(0x44556677), Limb(0x00112233)]);
            }

            #[test]
            fn from_le_slice() {
                let bytes = hex!("7766554433221100");
                let n = UintEx::from_le_slice(&bytes);
                assert_eq!(n.as_limbs(), &[Limb(0x44556677), Limb(0x00112233)]);
            }

            #[test]
            fn from_be_hex() {
                let n = UintEx::from_be_hex("0011223344556677");
                assert_eq!(n.as_limbs(), &[Limb(0x44556677), Limb(0x00112233)]);
            }

            #[test]
            fn from_le_hex() {
                let n = UintEx::from_le_hex("7766554433221100");
                assert_eq!(n.as_limbs(), &[Limb(0x44556677), Limb(0x00112233)]);
            }
        }
        64 => {
            use crate::U128 as UintEx;

            #[test]
            fn from_be_slice() {
                let bytes = hex!("00112233445566778899aabbccddeeff");
                let n = UintEx::from_be_slice(&bytes);
                assert_eq!(
                    n.as_limbs(),
                    &[Limb(0x8899aabbccddeeff), Limb(0x0011223344556677)]
                );
            }

            #[test]
            fn from_le_slice() {
                let bytes = hex!("ffeeddccbbaa99887766554433221100");
                let n = UintEx::from_le_slice(&bytes);
                assert_eq!(
                    n.as_limbs(),
                    &[Limb(0x8899aabbccddeeff), Limb(0x0011223344556677)]
                );
            }

            #[test]
            fn from_be_hex() {
                let n = UintEx::from_be_hex("00112233445566778899aabbccddeeff");
                assert_eq!(
                    n.as_limbs(),
                    &[Limb(0x8899aabbccddeeff), Limb(0x0011223344556677)]
                );
            }

            #[test]
            fn from_le_hex() {
                let n = UintEx::from_le_hex("ffeeddccbbaa99887766554433221100");
                assert_eq!(
                    n.as_limbs(),
                    &[Limb(0x8899aabbccddeeff), Limb(0x0011223344556677)]
                );
            }
        }
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn hex_upper() {
        let hex = "AAAAAAAABBBBBBBBCCCCCCCCDDDDDDDD";
        let n = U128::from_be_hex(hex);
        assert_eq!(hex, format!("{n:X}"));
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn hex_lower() {
        let hex = "aaaaaaaabbbbbbbbccccccccdddddddd";
        let n = U128::from_be_hex(hex);
        assert_eq!(hex, format!("{n:x}"));
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn fmt_binary() {
        let hex = "AAAAAAAABBBBBBBBCCCCCCCCDDDDDDDD";
        let n = U128::from_be_hex(hex);
        let expect = "\
            1010101010101010101010101010101010111011101110111011101110111011\
            1100110011001100110011001100110011011101110111011101110111011101";
        assert_eq!(expect, format!("{n:b}"));
    }

    #[test]
    fn from_str_radix_disallowed() {
        let tests = [
            ("", 10, DecodeError::Empty),
            ("+", 10, DecodeError::Empty),
            ("_", 10, DecodeError::InvalidDigit),
            ("0_", 10, DecodeError::InvalidDigit),
            ("0_", 10, DecodeError::InvalidDigit),
            ("a", 10, DecodeError::InvalidDigit),
            (".", 10, DecodeError::InvalidDigit),
            (
                "99999999999999999999999999999999",
                10,
                DecodeError::InputSize,
            ),
        ];
        for (input, radix, expect) in tests {
            assert_eq!(U64::from_str_radix_vartime(input, radix), Err(expect));
        }
    }

    #[test]
    fn from_str_radix_2() {
        let buf = &[b'1'; 128];
        let radix = U128::from_u64(2);
        let radix_max = U128::from_u64(1);
        let mut last: Option<U128> = None;
        for idx in (1..buf.len()).rev() {
            let res = U128::from_str_radix_vartime(
                core::str::from_utf8(&buf[..idx]).expect("utf-8 error"),
                2,
            )
            .expect("error decoding");
            assert!(!bool::from(res.is_zero()));
            if let Some(prev) = last {
                assert_eq!(res.saturating_mul(&radix).saturating_add(&radix_max), prev);
            }
            last = Some(res);
        }
        assert_eq!(last, Some(radix_max));
    }

    #[test]
    fn from_str_radix_5() {
        let buf = &[b'4'; 55];
        let radix = U128::from_u64(5);
        let radix_max = U128::from_u64(4);
        let mut last: Option<U128> = None;
        for idx in (1..buf.len()).rev() {
            let res = U128::from_str_radix_vartime(
                core::str::from_utf8(&buf[..idx]).expect("utf-8 error"),
                5,
            )
            .expect("error decoding");
            assert!(!bool::from(res.is_zero()));
            if let Some(prev) = last {
                assert_eq!(res.saturating_mul(&radix).saturating_add(&radix_max), prev);
            }
            last = Some(res);
        }
        assert_eq!(last, Some(radix_max));
    }

    #[test]
    fn from_str_radix_10() {
        let dec = "+340_282_366_920_938_463_463_374_607_431_768_211_455";
        let res = U128::from_str_radix_vartime(dec, 10).expect("error decoding");
        assert_eq!(res, U128::MAX);
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn from_str_radix_16() {
        let hex = "fedcba9876543210fedcba9876543210";
        let res = U128::from_str_radix_vartime(hex, 16).expect("error decoding");
        assert_eq!(hex, format!("{res:x}"));
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn encode_radix_8() {
        assert_eq!(
            &radix_encode_limbs_to_string(8, U128::MAX.as_limbs()),
            "3777777777777777777777777777777777777777777"
        );
        assert_eq!(&radix_encode_limbs_to_string(8, U128::ZERO.as_limbs()), "0");
        assert_eq!(&radix_encode_limbs_to_string(8, U128::ONE.as_limbs()), "1");

        let hex = "1234567123456765432107654321";
        let res = U128::from_str_radix_vartime(hex, 8).expect("error decoding");
        let out = radix_encode_limbs_to_string(8, res.as_limbs());
        assert_eq!(&out, hex);
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn encode_radix_10() {
        assert_eq!(
            &radix_encode_limbs_to_string(10, U128::MAX.as_limbs()),
            "340282366920938463463374607431768211455"
        );
        assert_eq!(
            &radix_encode_limbs_to_string(10, U128::ZERO.as_limbs()),
            "0"
        );
        assert_eq!(&radix_encode_limbs_to_string(10, U128::ONE.as_limbs()), "1");
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn encode_radix_16() {
        let hex = "fedcba9876543210fedcba9876543210";
        let res = U128::from_str_radix_vartime(hex, 16).expect("error decoding");
        let out = radix_encode_limbs_to_string(16, res.as_limbs());
        assert_eq!(&out, hex);
    }

    #[cfg(all(feature = "rand_core", feature = "alloc"))]
    #[test]
    fn encode_radix_round_trip() {
        use crate::{Random, U256};
        use rand_core::SeedableRng;
        let mut rng = chacha20::ChaCha8Rng::seed_from_u64(1);

        let rounds = if cfg!(miri) { 10 } else { 100 };
        for _ in 0..rounds {
            let uint = U256::random_from_rng(&mut rng);
            for radix in 2..=36 {
                let enc = uint.to_string_radix_vartime(radix);
                let res = U256::from_str_radix_vartime(&enc, radix).expect("decoding error");
                assert_eq!(
                    res, uint,
                    "round trip failure: radix {radix} encoded {uint} as {enc}"
                );
            }
        }
    }

    cpubits::cpubits! {
        32 => {
            #[test]
            fn encode_be_hex() {
                let n = UintEx::from_be_hex("0011223344556677");

                let bytes = n.to_be_bytes();
                assert_eq!(bytes.as_ref(), hex!("0011223344556677"));

                #[cfg(feature = "der")]
                assert_eq!(super::der::count_der_be_bytes(&n.limbs), 7);
            }
        }
        64 => {
            #[test]
            fn encode_be_hex() {
                let n = UintEx::from_be_hex("00112233445566778899aabbccddeeff");

                let bytes = n.to_be_bytes();
                assert_eq!(bytes.as_ref(), hex!("00112233445566778899aabbccddeeff"));

                #[cfg(feature = "der")]
                assert_eq!(super::der::count_der_be_bytes(&n.limbs), 15);
            }
        }
    }

    #[test]
    fn infer_sizes() {
        let bytes = b"0011223344556677";

        let n = EncodedUint::from(bytes);
        assert_eq!(n.as_slice(), bytes);

        let n = EncodedUint::from(*bytes);
        assert_eq!(n.as_slice(), bytes);

        let n: [u8; 16] = EncodedUint::from(bytes).into();
        assert_eq!(n.as_slice(), bytes);

        let n: [u8; 16] = (&EncodedUint::from(bytes)).into();
        assert_eq!(n.as_slice(), bytes);
    }

    #[allow(clippy::cast_lossless)]
    #[allow(trivial_numeric_casts)]
    #[cfg(feature = "alloc")]
    #[test]
    fn test_radix_large_divisor() {
        let radix = 5u32;
        let digits_limb = Word::MAX.ilog(radix as Word);
        let div_limb = NonZero(Limb((radix as Word).pow(digits_limb)));
        let (div_large, _digits_large, _shift_large) =
            radix_large_divisor::<4>(radix, div_limb, digits_limb as usize);
        assert!(
            Uint::new(div_large)
                .checked_mul(&Uint::<1>::from_u32(radix))
                .is_none()
                .to_bool()
        );
    }
}
