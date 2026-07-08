//! Tests for the `encode` module.

#![allow(clippy::cast_possible_truncation, reason = "tests")]
#![allow(clippy::integer_division_remainder_used, reason = "tests")]

use array::{
    Array, ArraySize,
    sizes::{U1, U2, U3, U4, U5, U6, U8, U10, U11, U12, U256},
    typenum::{Mod, Zero},
};
use core::{fmt::Debug, ops::Rem};
use getrandom::{
    SysRng,
    rand_core::{Rng, UnwrapErr},
};
use module_lattice::{
    Elem, Encode, EncodedPolynomial, EncodedVector, EncodingSize, Field, NttPolynomial, NttVector,
    Polynomial, Vector, byte_decode, byte_encode,
};

// Field used by ML-KEM.
module_lattice::define_field!(KyberField, u16, u32, u64, 3329);

type Int = u16;
type DecodedValue = module_lattice::DecodedValue<KyberField>;

/// A helper trait to construct larger arrays by repeating smaller ones
trait Repeat<T: Clone, D: ArraySize> {
    fn repeat(&self) -> Array<T, D>;
}

impl<T, N, D> Repeat<T, D> for Array<T, N>
where
    N: ArraySize,
    T: Clone,
    D: ArraySize + Rem<N>,
    Mod<D, N>: Zero,
{
    #[allow(clippy::integer_division_remainder_used)]
    fn repeat(&self) -> Array<T, D> {
        Array::from_fn(|i| self[i % N::USIZE].clone())
    }
}

// ========================================
// byte_encode / byte_decode tests
// ========================================

#[allow(clippy::integer_division_remainder_used)]
fn byte_codec_test<D>(decoded: &DecodedValue, encoded: &EncodedPolynomial<D>)
where
    D: EncodingSize,
{
    // Test known answer
    let actual_encoded = byte_encode::<KyberField, D>(decoded);
    assert_eq!(&actual_encoded, encoded);

    let actual_decoded = byte_decode::<KyberField, D>(encoded);
    assert_eq!(&actual_decoded, decoded);

    // Test random decode/encode and encode/decode round trips
    let mut rng = UnwrapErr(SysRng);
    let decoded = Array::<Int, U256>::from_fn(|_| (rng.next_u32() & 0xFFFF) as Int);
    let m = match D::USIZE {
        12 => KyberField::Q,
        d => 1 << d,
    };
    let decoded = decoded.iter().map(|x| Elem::new(x % m)).collect();

    let actual_encoded = byte_encode::<KyberField, D>(&decoded);
    let actual_decoded = byte_decode::<KyberField, D>(&actual_encoded);
    assert_eq!(actual_decoded, decoded);

    let actual_reencoded = byte_encode::<KyberField, D>(&decoded);
    assert_eq!(actual_reencoded, actual_encoded);
}

#[test]
fn byte_codec() {
    // The 1-bit can only represent decoded values equal to 0 or 1.
    let decoded: DecodedValue = Array::<_, U2>([Elem::new(0), Elem::new(1)]).repeat();
    let encoded: EncodedPolynomial<U1> = Array([0xaa; 32]);
    byte_codec_test::<U1>(&decoded, &encoded);

    // For other codec widths, we use a standard sequence
    let decoded: DecodedValue = Array::<_, U8>([
        Elem::new(0),
        Elem::new(1),
        Elem::new(2),
        Elem::new(3),
        Elem::new(4),
        Elem::new(5),
        Elem::new(6),
        Elem::new(7),
    ])
    .repeat();

    let encoded: EncodedPolynomial<U4> = Array::<_, U4>([0x10, 0x32, 0x54, 0x76]).repeat();
    byte_codec_test::<U4>(&decoded, &encoded);

    let encoded: EncodedPolynomial<U5> = Array::<_, U5>([0x20, 0x88, 0x41, 0x8a, 0x39]).repeat();
    byte_codec_test::<U5>(&decoded, &encoded);

    let encoded: EncodedPolynomial<U6> =
        Array::<_, U6>([0x40, 0x20, 0x0c, 0x44, 0x61, 0x1c]).repeat();
    byte_codec_test::<U6>(&decoded, &encoded);

    let encoded: EncodedPolynomial<U10> =
        Array::<_, U10>([0x00, 0x04, 0x20, 0xc0, 0x00, 0x04, 0x14, 0x60, 0xc0, 0x01]).repeat();
    byte_codec_test::<U10>(&decoded, &encoded);

    let encoded: EncodedPolynomial<U11> = Array::<_, U11>([
        0x00, 0x08, 0x80, 0x00, 0x06, 0x40, 0x80, 0x02, 0x18, 0xe0, 0x00,
    ])
    .repeat();
    byte_codec_test::<U11>(&decoded, &encoded);

    let encoded: EncodedPolynomial<U12> = Array::<_, U12>([
        0x00, 0x10, 0x00, 0x02, 0x30, 0x00, 0x04, 0x50, 0x00, 0x06, 0x70, 0x00,
    ])
    .repeat();
    byte_codec_test::<U12>(&decoded, &encoded);
}

#[test]
fn byte_codec_12_mod() {
    // DecodeBytes_12 is required to reduce mod q
    let encoded: EncodedPolynomial<U12> = Array([0xff; 384]);
    let decoded: DecodedValue = Array([Elem::new(0xfff % KyberField::Q); 256]);

    let actual_decoded = byte_decode::<KyberField, U12>(&encoded);
    assert_eq!(actual_decoded, decoded);
}

#[test]
fn byte_encode_decode_d1_roundtrip() {
    // D=1: Single bit encoding
    let vals: [Elem<KyberField>; 256] = core::array::from_fn(|i| Elem::new((i % 2) as u16));

    let encoded = byte_encode::<KyberField, U1>(&vals.into());
    let decoded = byte_decode::<KyberField, U1>(&encoded);

    for (i, (dec, val)) in decoded.iter().zip(vals.iter()).enumerate() {
        assert_eq!(dec.0, val.0, "Mismatch at index {i}");
    }
}

#[test]
fn byte_encode_decode_d4_roundtrip() {
    // D=4: 4-bit encoding
    let vals: [Elem<KyberField>; 256] = core::array::from_fn(|i| Elem::new((i % 16) as u16));

    let encoded = byte_encode::<KyberField, U4>(&vals.into());
    let decoded = byte_decode::<KyberField, U4>(&encoded);

    for (i, (dec, val)) in decoded.iter().zip(vals.iter()).enumerate() {
        assert_eq!(dec.0, val.0, "Mismatch at index {i}");
    }
}

#[test]
fn byte_encode_decode_d10_roundtrip() {
    // D=10: 10-bit encoding
    let vals: [Elem<KyberField>; 256] = core::array::from_fn(|i| Elem::new((i % 1024) as u16));

    let encoded = byte_encode::<KyberField, U10>(&vals.into());
    let decoded = byte_decode::<KyberField, U10>(&encoded);

    for (i, (dec, val)) in decoded.iter().zip(vals.iter()).enumerate() {
        assert_eq!(dec.0, val.0, "Mismatch at index {i}");
    }
}

#[test]
fn byte_encode_decode_d12_roundtrip() {
    // D=12: 12-bit encoding (special case with modular reduction)
    // Values up to q-1 (3328)
    let vals: [Elem<KyberField>; 256] = core::array::from_fn(|i| Elem::new((i * 13) as u16 % 3329));

    let encoded = byte_encode::<KyberField, U12>(&vals.into());
    let decoded = byte_decode::<KyberField, U12>(&encoded);

    for (i, (dec, val)) in decoded.iter().zip(vals.iter()).enumerate() {
        assert_eq!(dec.0, val.0, "Mismatch at index {i}");
    }
}

#[test]
fn byte_encode_decode_d12_modular_reduction() {
    // Test that D=12 properly reduces values >= Q
    // Fill with values near and above Q
    let vals: [Elem<KyberField>; 256] =
        core::array::from_fn(|i| Elem::new(3329 + (i as u16) % 100));

    let encoded = byte_encode::<KyberField, U12>(&vals.into());
    let decoded = byte_decode::<KyberField, U12>(&encoded);

    // After decode, values should be reduced mod Q
    for (i, dec) in decoded.iter().enumerate() {
        assert!(dec.0 < 3329, "Value at {i} not reduced: {}", dec.0);
    }
}

#[test]
fn byte_encode_zero_values() {
    let vals = [Elem::<KyberField>::new(0); 256];

    let encoded = byte_encode::<KyberField, U4>(&vals.into());
    let decoded = byte_decode::<KyberField, U4>(&encoded);

    for dec in &decoded {
        assert_eq!(dec.0, 0);
    }
}

#[test]
fn byte_encode_max_values() {
    // D=4: max value is 15
    let vals = [Elem::<KyberField>::new(15); 256];

    let encoded = byte_encode::<KyberField, U4>(&vals.into());
    let decoded = byte_decode::<KyberField, U4>(&encoded);

    for dec in &decoded {
        assert_eq!(dec.0, 15);
    }
}

// ========================================
// Polynomial encoding tests
// ========================================

#[test]
fn polynomial_encode_decode_roundtrip() {
    let coeffs: [Elem<KyberField>; 256] = core::array::from_fn(|i| Elem::new((i * 7) as u16 % 16));
    let p = Polynomial::<KyberField>::new(coeffs.into());

    let encoded = <Polynomial<KyberField> as Encode<U4>>::encode(&p);
    let decoded = <Polynomial<KyberField> as Encode<U4>>::decode(&encoded);

    assert_eq!(p, decoded);
}

#[test]
fn polynomial_encode_decode_d12() {
    let coeffs: [Elem<KyberField>; 256] =
        core::array::from_fn(|i| Elem::new((i * 13) as u16 % 3329));
    let p = Polynomial::<KyberField>::new(coeffs.into());

    let encoded = <Polynomial<KyberField> as Encode<U12>>::encode(&p);
    let decoded = <Polynomial<KyberField> as Encode<U12>>::decode(&encoded);

    assert_eq!(p, decoded);
}

// ========================================
// Vector encoding tests
// ========================================

fn vector_codec_known_answer_test<D, T>(decoded: &T, encoded: &Array<u8, T::EncodedSize>)
where
    D: EncodingSize,
    T: Encode<D> + PartialEq + Debug,
{
    let actual_encoded = decoded.encode();
    assert_eq!(&actual_encoded, encoded);

    let actual_decoded: T = Encode::decode(encoded);
    assert_eq!(&actual_decoded, decoded);
}

#[test]
fn vector_codec() {
    let poly = Polynomial::new(
        Array::<_, U8>([
            Elem::new(0),
            Elem::new(1),
            Elem::new(2),
            Elem::new(3),
            Elem::new(4),
            Elem::new(5),
            Elem::new(6),
            Elem::new(7),
        ])
        .repeat(),
    );

    // The required vector sizes are 2, 3, and 4.
    let decoded: Vector<KyberField, U2> = Vector::new(Array([poly, poly]));
    let encoded: EncodedVector<U5, U2> = Array::<_, U5>([0x20, 0x88, 0x41, 0x8a, 0x39]).repeat();
    vector_codec_known_answer_test::<U5, Vector<KyberField, U2>>(&decoded, &encoded);

    let decoded: Vector<KyberField, U3> = Vector::new(Array([poly, poly, poly]));
    let encoded: EncodedVector<U5, U3> = Array::<_, U5>([0x20, 0x88, 0x41, 0x8a, 0x39]).repeat();
    vector_codec_known_answer_test::<U5, Vector<KyberField, U3>>(&decoded, &encoded);

    let decoded: Vector<KyberField, U4> = Vector::new(Array([poly, poly, poly, poly]));
    let encoded: EncodedVector<U5, U4> = Array::<_, U5>([0x20, 0x88, 0x41, 0x8a, 0x39]).repeat();
    vector_codec_known_answer_test::<U5, Vector<KyberField, U4>>(&decoded, &encoded);
}

#[test]
fn vector_encode_decode_roundtrip() {
    use array::typenum::U2;

    let coeffs1: [Elem<KyberField>; 256] = core::array::from_fn(|i| Elem::new((i * 3) as u16 % 16));
    let coeffs2: [Elem<KyberField>; 256] = core::array::from_fn(|i| Elem::new((i * 5) as u16 % 16));

    let p1 = Polynomial::<KyberField>::new(coeffs1.into());
    let p2 = Polynomial::<KyberField>::new(coeffs2.into());
    let v: Vector<KyberField, U2> = Vector::new([p1, p2].into());

    let encoded = <Vector<KyberField, U2> as Encode<U4>>::encode(&v);
    let decoded = <Vector<KyberField, U2> as Encode<U4>>::decode(&encoded);

    assert_eq!(v, decoded);
}

// ========================================
// NttPolynomial encoding tests
// ========================================

#[test]
fn ntt_polynomial_encode_decode_roundtrip() {
    let coeffs: [Elem<KyberField>; 256] = core::array::from_fn(|i| Elem::new((i * 7) as u16 % 16));
    let p = NttPolynomial::<KyberField>::new(coeffs.into());

    let encoded = <NttPolynomial<KyberField> as Encode<U4>>::encode(&p);
    let decoded = <NttPolynomial<KyberField> as Encode<U4>>::decode(&encoded);

    assert_eq!(p, decoded);
}

#[test]
fn ntt_polynomial_encode_decode_d12() {
    let coeffs: [Elem<KyberField>; 256] =
        core::array::from_fn(|i| Elem::new((i * 13) as u16 % 3329));
    let p = NttPolynomial::<KyberField>::new(coeffs.into());

    let encoded = <NttPolynomial<KyberField> as Encode<U12>>::encode(&p);
    let decoded = <NttPolynomial<KyberField> as Encode<U12>>::decode(&encoded);

    assert_eq!(p, decoded);
}

// ========================================
// NttVector encoding tests
// ========================================

#[test]
fn ntt_vector_encode_decode_roundtrip() {
    use array::typenum::U2;

    let coeffs1: [Elem<KyberField>; 256] = core::array::from_fn(|i| Elem::new((i * 3) as u16 % 16));
    let coeffs2: [Elem<KyberField>; 256] = core::array::from_fn(|i| Elem::new((i * 5) as u16 % 16));

    let p1 = NttPolynomial::<KyberField>::new(coeffs1.into());
    let p2 = NttPolynomial::<KyberField>::new(coeffs2.into());
    let v: NttVector<KyberField, U2> = NttVector::new([p1, p2].into());

    let encoded = <NttVector<KyberField, U2> as Encode<U4>>::encode(&v);
    let decoded = <NttVector<KyberField, U2> as Encode<U4>>::decode(&encoded);

    assert_eq!(v, decoded);
}

// ========================================
// Encoding size verification
// ========================================

#[test]
fn encoded_polynomial_size_d4() {
    // D=4 means 4 bits per coefficient, 256 coefficients = 1024 bits = 128 bytes
    let coeffs = [Elem::<KyberField>::new(0); 256];
    let p = Polynomial::<KyberField>::new(coeffs.into());

    let encoded = <Polynomial<KyberField> as Encode<U4>>::encode(&p);
    assert_eq!(encoded.len(), 128);
}

#[test]
fn encoded_polynomial_size_d12() {
    // D=12 means 12 bits per coefficient, 256 coefficients = 3072 bits = 384 bytes
    let coeffs = [Elem::<KyberField>::new(0); 256];
    let p = Polynomial::<KyberField>::new(coeffs.into());

    let encoded = <Polynomial<KyberField> as Encode<U12>>::encode(&p);
    assert_eq!(encoded.len(), 384);
}

#[test]
fn encoded_vector_size() {
    use array::typenum::U3;

    // D=4, K=3: 128 bytes per polynomial * 3 = 384 bytes
    let coeffs = [Elem::<KyberField>::new(0); 256];
    let p = Polynomial::<KyberField>::new(coeffs.into());
    let v: Vector<KyberField, U3> = Vector::new([p, p, p].into());

    let encoded = <Vector<KyberField, U3> as Encode<U4>>::encode(&v);
    assert_eq!(encoded.len(), 384);
}

// ========================================
// Edge cases and boundary tests
// ========================================

#[test]
fn byte_encode_alternating_bits() {
    // Test alternating patterns to catch bit manipulation issues
    let vals: [Elem<KyberField>; 256] =
        core::array::from_fn(|i| Elem::new(if i % 2 == 0 { 0b0101 } else { 0b1010 }));

    let encoded = byte_encode::<KyberField, U4>(&vals.into());
    let decoded = byte_decode::<KyberField, U4>(&encoded);

    for (i, (dec, val)) in decoded.iter().zip(vals.iter()).enumerate() {
        assert_eq!(dec.0, val.0, "Mismatch at index {i}");
    }
}

#[test]
fn byte_encode_sequential_values() {
    // Sequential values to catch ordering issues
    let vals: [Elem<KyberField>; 256] = core::array::from_fn(|i| Elem::new(i as u16 % 16));

    let encoded = byte_encode::<KyberField, U4>(&vals.into());
    let decoded = byte_decode::<KyberField, U4>(&encoded);

    for (i, (dec, val)) in decoded.iter().zip(vals.iter()).enumerate() {
        assert_eq!(dec.0, val.0, "Mismatch at index {i}");
    }
}
