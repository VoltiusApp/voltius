use std::mem::{size_of, transmute};

/// `FixedInt` provides encoding/decoding to and from fixed int representations.
///
/// The emitted bytestring contains the bytes of the integer in machine endianness.
pub trait FixedInt: Sized + Copy {
    const REQUIRED_SPACE: usize;
    /// Returns how many bytes are required to represent the given type.
    fn required_space() -> usize;
    /// Encode a value into the given slice. `dst` must be exactly `REQUIRED_SPACE` bytes.
    fn encode_fixed(self, dst: &mut [u8]);
    /// Decode a value from the given slice. `src` must be exactly `REQUIRED_SPACE` bytes.
    fn decode_fixed(src: &[u8]) -> Self;
    /// Perform a transmute, i.e. return a "view" into the integer's memory, which is faster than
    /// performing a copy.
    fn encode_fixed_light<'a>(&'a self) -> &'a [u8];

    /// Helper: Encode the value and return a Vec.
    fn encode_fixed_vec(self) -> Vec<u8> {
        let mut v = Vec::new();
        v.resize(Self::required_space(), 0);
        self.encode_fixed(&mut v[..]);
        v
    }
    /// Helper: Decode the value from the Vec.
    fn decode_fixed_vec(v: &Vec<u8>) -> Self {
        assert_eq!(v.len(), Self::required_space());
        Self::decode_fixed(&v[..])
    }
}

macro_rules! impl_fixedint {
    ($t:ty) => {
        impl FixedInt for $t {
            const REQUIRED_SPACE: usize = size_of::<Self>();

            fn required_space() -> usize {
                Self::REQUIRED_SPACE
            }

            fn encode_fixed_light<'a>(&'a self) -> &'a [u8] {
                return unsafe {
                    std::slice::from_raw_parts(
                        transmute::<&$t, *const u8>(&self),
                        Self::REQUIRED_SPACE,
                    )
                };
            }

            fn encode_fixed(self, dst: &mut [u8]) {
                assert_eq!(dst.len(), Self::REQUIRED_SPACE);

                #[allow(unused_mut)]
                let mut encoded =
                    unsafe { &*(&self as *const $t as *const [u8; Self::REQUIRED_SPACE]) };

                #[cfg(target_endian = "big")]
                if Self::REQUIRED_SPACE > 1 {
                    let mut encoded_rev = [0 as u8; Self::REQUIRED_SPACE];
                    encoded_rev.copy_from_slice(encoded);
                    encoded_rev.reverse();
                    dst.clone_from_slice(&encoded_rev);
                    return;
                }

                dst.clone_from_slice(encoded);
            }

            #[cfg(target_endian = "little")]
            fn decode_fixed(src: &[u8]) -> $t {
                unsafe { (src.as_ptr() as *const $t).read_unaligned() }
            }

            #[cfg(target_endian = "big")]
            fn decode_fixed(src: &[u8]) -> $t {
                match Self::REQUIRED_SPACE {
                    1 => unsafe { (src.as_ptr() as *const $t).read_unaligned() },
                    _ => {
                        let mut src_fin = [0 as u8; Self::REQUIRED_SPACE];
                        src_fin.copy_from_slice(src);
                        src_fin.reverse();
                        unsafe { (src_fin.as_ptr() as *const $t).read_unaligned() }
                    }
                }
            }
        }
    };
}

impl_fixedint!(usize);
impl_fixedint!(u64);
impl_fixedint!(u32);
impl_fixedint!(u16);
impl_fixedint!(u8);
impl_fixedint!(isize);
impl_fixedint!(i64);
impl_fixedint!(i32);
impl_fixedint!(i16);
impl_fixedint!(i8);
