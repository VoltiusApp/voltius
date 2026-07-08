//! `hybrid-array` integration with `Uint`.
// TODO(tarcieri): completely phase out `hybrid-array` when const generics are powerful enough

use crate::{ArrayDecoding, ArrayEncoding, ByteArray, EncodedUint, Limb};
use hybrid_array::{Array, ArrayN, typenum};

macro_rules! impl_uint_array_encoding {
    ($(($uint:ident, $bytes:path)),+) => {
        $(
            use crate::$uint;

            impl ArrayEncoding for $uint {
                type ByteSize = $bytes;

                #[inline]
                fn from_be_byte_array(bytes: ByteArray<Self>) -> Self {
                    Self::from_be_slice(&bytes)
                }

                #[inline]
                fn from_le_byte_array(bytes: ByteArray<Self>) -> Self {
                    Self::from_le_slice(&bytes)
                }

                #[inline]
                fn to_be_byte_array(&self) -> ByteArray<Self> {
                    let mut result = Array::default();
                    self.write_be_bytes(&mut result);
                    result
                }

                #[inline]
                fn to_le_byte_array(&self) -> ByteArray<Self> {
                    let mut result = Array::default();
                    self.write_le_bytes(&mut result);
                    result
                }
            }

            impl ArrayDecoding for Array<u8, $bytes> {
                type Output = $uint;

                fn into_uint_be(self) -> Self::Output {
                    Self::Output::from_be_byte_array(self)
                }

                fn into_uint_le(self) -> Self::Output {
                    Self::Output::from_le_byte_array(self)
                }
            }

            impl From<EncodedUint<{ $uint::LIMBS }>> for ArrayN<u8, { $uint::LIMBS * Limb::BYTES }> {
                #[inline]
                fn from(input: EncodedUint<{ $uint::LIMBS }>) -> Self {
                    let mut output = Self::default();
                    output.as_mut_slice().copy_from_slice(input.as_ref());
                    output
                }
            }

            impl From<ArrayN<u8, { $uint::LIMBS * Limb::BYTES }>> for EncodedUint< { $uint::LIMBS }> {
                #[inline]
                fn from(input: ArrayN<u8, { $uint::LIMBS * Limb::BYTES }>) -> Self {
                    let mut output = Self::default();
                    output.as_mut().copy_from_slice(input.as_ref());
                    output
                }
            }
        )+
     };
}

// TODO(tarcieri): use `generic_const_exprs` when stable to make generic around bits.
impl_uint_array_encoding! {
    (U64, typenum::U8),
    (U128, typenum::U16),
    (U192, typenum::U24),
    (U256, typenum::U32),
    (U384, typenum::U48),
    (U448, typenum::U56),
    (U512, typenum::U64),
    (U576, typenum::U72),
    (U768, typenum::U96),
    (U832, typenum::U104),
    (U896, typenum::U112),
    (U1024, typenum::U128),
    (U1536, typenum::U192),
    (U1792, typenum::U224),
    (U2048, typenum::U256),
    (U3072, typenum::U384),
    (U3584, typenum::U448),
    (U4096, typenum::U512),
    (U6144, typenum::U768),
    (U8192, typenum::U1024)
}

cpubits::cpubits! {
    32 => {
        impl_uint_array_encoding! {
            (U224, typenum::U28), // For NIST P-224
            (U544, typenum::U68)  // For NIST P-521
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{ArrayDecoding, ArrayEncoding, Limb};
    use hex_literal::hex;

    cpubits::cpubits! {
        32 => { use crate::U64 as UintEx; }
        64 => { use crate::U128 as UintEx; }
    }

    /// Byte array that corresponds to `UintEx`
    type ByteArray = crate::ByteArray<UintEx>;

    cpubits::cpubits! {
        32 => {
            #[test]
            fn from_be_byte_array() {
                let n = UintEx::from_be_byte_array(hex!("0011223344556677").into());
                assert_eq!(n.as_limbs(), &[Limb(0x44556677), Limb(0x00112233)]);
            }

            #[test]
            fn from_le_byte_array() {
                let n = UintEx::from_le_byte_array(hex!("7766554433221100").into());
                assert_eq!(n.as_limbs(), &[Limb(0x44556677), Limb(0x00112233)]);
            }

            #[test]
            fn to_be_byte_array() {
                let expected_bytes = ByteArray::from(hex!("0011223344556677"));
                let actual_bytes = UintEx::from_be_byte_array(expected_bytes).to_be_byte_array();
                assert_eq!(expected_bytes, actual_bytes);
            }

            #[test]
            fn to_le_byte_array() {
                let expected_bytes = ByteArray::from(hex!("7766554433221100"));
                let actual_bytes = UintEx::from_le_byte_array(expected_bytes).to_le_byte_array();
                assert_eq!(expected_bytes, actual_bytes);
            }

            #[test]
            fn into_uint_be() {
                let expected_bytes = ByteArray::from(hex!("0011223344556677"));
                let actual_bytes = expected_bytes.into_uint_be().to_be_byte_array();
                assert_eq!(expected_bytes, actual_bytes);
            }

            #[test]
            fn into_uint_le() {
                let expected_bytes = ByteArray::from(hex!("7766554433221100"));
                let actual_bytes = expected_bytes.into_uint_le().to_le_byte_array();
                assert_eq!(expected_bytes, actual_bytes);
            }
        }
        64 => {
            #[test]
            fn from_be_byte_array() {
                let n = UintEx::from_be_byte_array(hex!("00112233445566778899aabbccddeeff").into());
                assert_eq!(
                    n.as_limbs(),
                    &[Limb(0x8899aabbccddeeff), Limb(0x0011223344556677)]
                );
            }

            #[test]
            fn from_le_byte_array() {
                let n = UintEx::from_le_byte_array(hex!("ffeeddccbbaa99887766554433221100").into());
                assert_eq!(
                    n.as_limbs(),
                    &[Limb(0x8899aabbccddeeff), Limb(0x0011223344556677)]
                );
            }

            #[test]
            fn to_be_byte_array() {
                let expected_bytes = ByteArray::from(hex!("00112233445566778899aabbccddeeff"));
                let actual_bytes = UintEx::from_be_byte_array(expected_bytes).to_be_byte_array();
                assert_eq!(expected_bytes, actual_bytes);
            }

            #[test]
            fn to_le_byte_array() {
                let expected_bytes = ByteArray::from(hex!("ffeeddccbbaa99887766554433221100"));
                let actual_bytes = UintEx::from_le_byte_array(expected_bytes).to_le_byte_array();
                assert_eq!(expected_bytes, actual_bytes);
            }

            #[test]
            fn into_uint_be() {
                let expected_bytes = ByteArray::from(hex!("00112233445566778899aabbccddeeff"));
                let actual_bytes = expected_bytes.into_uint_be().to_be_byte_array();
                assert_eq!(expected_bytes, actual_bytes);
            }

            #[test]
            fn into_uint_le() {
                let expected_bytes = ByteArray::from(hex!("ffeeddccbbaa99887766554433221100"));
                let actual_bytes = expected_bytes.into_uint_le().to_le_byte_array();
                assert_eq!(expected_bytes, actual_bytes);
            }
        }
    }

    #[allow(clippy::cast_possible_truncation)]
    mod encoded_uint {
        const LIMBS: usize = 4;
        const BYTES: usize = crate::Limb::BYTES * LIMBS;

        type Array = hybrid_array::ArrayN<u8, { BYTES }>;
        type EncodedUint = crate::EncodedUint<LIMBS>;

        const ARRAY: Array = {
            let mut i = 0;
            let mut ret = [0u8; BYTES];
            while i < BYTES {
                ret[i] = i as u8;
                i += 1;
            }
            hybrid_array::Array(ret)
        };

        #[test]
        fn from_impls_for_encoded_uint() {
            let encoded_uint = EncodedUint::from(ARRAY);
            assert_eq!(encoded_uint.as_ref(), ARRAY.as_slice());

            let array = Array::from(encoded_uint);
            assert_eq!(array, ARRAY);
        }
    }
}
