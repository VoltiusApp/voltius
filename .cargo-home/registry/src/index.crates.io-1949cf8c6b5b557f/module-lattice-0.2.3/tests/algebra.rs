//! Tests for the `algebra` module.

#![allow(clippy::cast_possible_truncation, reason = "tests")]
#![allow(clippy::integer_division_remainder_used, reason = "tests")]

use array::typenum::U2;
use module_lattice::{Elem, Field, NttMatrix, NttPolynomial, NttVector, Polynomial, Vector};

// Field used by ML-KEM.
module_lattice::define_field!(KyberField, u16, u32, u64, 3329);

// Field used by ML-DSA.
module_lattice::define_field!(DilithiumField, u32, u64, u128, 8_380_417);

#[test]
fn small_reduce() {
    assert_eq!(KyberField::small_reduce(3328), 3328);
    assert_eq!(KyberField::small_reduce(3329), 0);

    assert_eq!(DilithiumField::small_reduce(8_380_416), 8_380_416);
    assert_eq!(DilithiumField::small_reduce(8_380_417), 0);
}

#[test]
fn barrett_reduce() {
    // Test Barrett reduction produces values in correct range
    assert_eq!(KyberField::barrett_reduce(0), 0);
    assert_eq!(KyberField::barrett_reduce(3329), 0);
    assert_eq!(KyberField::barrett_reduce(3328), 3328);
    assert_eq!(KyberField::barrett_reduce(6658), 0); // 2 * 3329

    // Large product that requires Barrett reduction
    let product: u32 = 3000 * 3000; // 9_000_000
    let reduced = KyberField::barrett_reduce(product);
    assert!(reduced < 3329);
    assert_eq!(reduced, (product % 3329) as u16);

    // Test with Dilithium field
    assert_eq!(DilithiumField::barrett_reduce(0), 0);
    assert_eq!(DilithiumField::barrett_reduce(8_380_417), 0);
}

// ========================================
// Elem<F> arithmetic tests
// ========================================

#[test]
fn elem_negation() {
    let a: Elem<KyberField> = Elem::new(100);
    let neg_a = -a;
    // -100 mod 3329 = 3229
    assert_eq!(neg_a.0, 3229);

    // Double negation returns original
    assert_eq!((-neg_a).0, 100);

    // Negation of zero is zero
    let zero: Elem<KyberField> = Elem::new(0);
    assert_eq!((-zero).0, 0);
}

#[test]
fn elem_addition() {
    let a: Elem<KyberField> = Elem::new(100);
    let b: Elem<KyberField> = Elem::new(200);
    let sum = a + b;
    assert_eq!(sum.0, 300);

    // Test wraparound
    let c: Elem<KyberField> = Elem::new(3300);
    let d: Elem<KyberField> = Elem::new(100);
    let wrapped = c + d;
    assert_eq!(wrapped.0, 71); // (3300 + 100) % 3329 = 71

    // Adding zero is identity
    let zero: Elem<KyberField> = Elem::new(0);
    assert_eq!((a + zero).0, 100);
}

#[test]
fn elem_subtraction() {
    let a: Elem<KyberField> = Elem::new(300);
    let b: Elem<KyberField> = Elem::new(100);
    let diff = a - b;
    assert_eq!(diff.0, 200);

    // Test negative result wraps correctly
    let c: Elem<KyberField> = Elem::new(100);
    let d: Elem<KyberField> = Elem::new(300);
    let wrapped = c - d;
    // 100 - 300 = -200 mod 3329 = 3129
    assert_eq!(wrapped.0, 3129);

    // Subtracting zero is identity
    let zero: Elem<KyberField> = Elem::new(0);
    assert_eq!((a - zero).0, 300);

    // Subtracting self gives zero
    assert_eq!((a - a).0, 0);
}

#[test]
fn elem_multiplication() {
    let a: Elem<KyberField> = Elem::new(100);
    let b: Elem<KyberField> = Elem::new(200);
    let prod = a * b;
    assert_eq!(prod.0, (100 * 200) % 3329);

    // Multiply by one is identity
    let one: Elem<KyberField> = Elem::new(1);
    assert_eq!((a * one).0, 100);

    // Multiply by zero is zero
    let zero: Elem<KyberField> = Elem::new(0);
    assert_eq!((a * zero).0, 0);

    // Test large product requiring Barrett reduction
    let c: Elem<KyberField> = Elem::new(3000);
    let d: Elem<KyberField> = Elem::new(3000);
    let large_prod = c * d;
    assert_eq!(large_prod.0, ((3000u32 * 3000u32) % 3329) as u16);
}

#[test]
fn elem_arithmetic_consistency() {
    // Test: a + b - b = a
    let a: Elem<KyberField> = Elem::new(1234);
    let b: Elem<KyberField> = Elem::new(5678 % 3329);
    assert_eq!((a + b - b).0, a.0);

    // Test: a - b + b = a
    assert_eq!((a - b + b).0, a.0);

    // Test: a + (-a) = 0
    assert_eq!((a + (-a)).0, 0);
}

// ========================================
// Polynomial<F> arithmetic tests
// ========================================

fn make_test_polynomial<F: Field>(base: F::Int) -> Polynomial<F>
where
    F::Int: From<u8>,
{
    let mut coeffs = [Elem::new(F::Int::from(0u8)); 256];
    for (i, c) in coeffs.iter_mut().enumerate().take(10) {
        *c = Elem::new(base + F::Int::from(i as u8));
    }
    Polynomial::new(coeffs.into())
}

#[test]
fn polynomial_addition() {
    let p1 = make_test_polynomial::<KyberField>(100);
    let p2 = make_test_polynomial::<KyberField>(200);
    let sum = &p1 + &p2;

    // Check first few coefficients
    assert_eq!(sum.0[0].0, 300); // 100 + 200
    assert_eq!(sum.0[1].0, 302); // 101 + 201
    assert_eq!(sum.0[9].0, 318); // 109 + 209

    // Remaining coefficients should be 0
    assert_eq!(sum.0[10].0, 0);
}

#[test]
fn polynomial_subtraction() {
    let p1 = make_test_polynomial::<KyberField>(300);
    let p2 = make_test_polynomial::<KyberField>(100);
    let diff = &p1 - &p2;

    // Check first few coefficients
    assert_eq!(diff.0[0].0, 200); // 300 - 100
    assert_eq!(diff.0[1].0, 200); // 301 - 101
}

#[test]
fn polynomial_negation() {
    let p = make_test_polynomial::<KyberField>(100);
    let neg_p = -&p;

    // Check negation: -100 mod 3329 = 3229
    assert_eq!(neg_p.0[0].0, 3229);
    // -101 mod 3329 = 3228
    assert_eq!(neg_p.0[1].0, 3228);

    // Double negation returns original
    let double_neg = -&neg_p;
    assert_eq!(double_neg.0[0].0, p.0[0].0);
}

#[test]
fn polynomial_scalar_multiplication() {
    let p = make_test_polynomial::<KyberField>(100);
    let scalar: Elem<KyberField> = Elem::new(3);
    let scaled = scalar * &p;

    assert_eq!(scaled.0[0].0, 300); // 3 * 100
    assert_eq!(scaled.0[1].0, 303); // 3 * 101
}

// ========================================
// Vector<F, K> arithmetic tests
// ========================================

fn make_test_vector<F: Field>(base: F::Int) -> Vector<F, U2>
where
    F::Int: From<u8>,
{
    let p1 = make_test_polynomial::<F>(base);
    let p2 = make_test_polynomial::<F>(base + F::Int::from(50u8));
    Vector::new([p1, p2].into())
}

#[test]
fn vector_addition() {
    let v1 = make_test_vector::<KyberField>(100);
    let v2 = make_test_vector::<KyberField>(200);
    let sum = &v1 + &v2;

    // First polynomial: 100+200=300, second: 150+250=400
    assert_eq!(sum.0[0].0[0].0, 300);
    assert_eq!(sum.0[1].0[0].0, 400);
}

#[test]
fn vector_addition_owned() {
    let v1 = make_test_vector::<KyberField>(100);
    let v2 = make_test_vector::<KyberField>(200);
    let sum = v1 + v2;

    assert_eq!(sum.0[0].0[0].0, 300);
    assert_eq!(sum.0[1].0[0].0, 400);
}

#[test]
fn vector_subtraction() {
    let v1 = make_test_vector::<KyberField>(300);
    let v2 = make_test_vector::<KyberField>(100);
    let diff = &v1 - &v2;

    // 300 - 100 = 200
    assert_eq!(diff.0[0].0[0].0, 200);
    // 350 - 150 = 200
    assert_eq!(diff.0[1].0[0].0, 200);
}

#[test]
fn vector_negation() {
    let v = make_test_vector::<KyberField>(100);
    let neg_v = -&v;

    // -100 mod 3329 = 3229
    assert_eq!(neg_v.0[0].0[0].0, 3229);
}

#[test]
fn vector_scalar_multiplication() {
    let v = make_test_vector::<KyberField>(100);
    let scalar: Elem<KyberField> = Elem::new(2);
    let scaled = scalar * &v;

    assert_eq!(scaled.0[0].0[0].0, 200); // 2 * 100
    assert_eq!(scaled.0[1].0[0].0, 300); // 2 * 150
}

// ========================================
// NttPolynomial<F> arithmetic tests
// ========================================

fn make_test_ntt_polynomial<F: Field>(base: F::Int) -> NttPolynomial<F>
where
    F::Int: From<u8>,
{
    let mut coeffs = [Elem::new(F::Int::from(0u8)); 256];
    for (i, c) in coeffs.iter_mut().enumerate().take(10) {
        *c = Elem::new(base + F::Int::from(i as u8));
    }
    NttPolynomial::new(coeffs.into())
}

#[test]
fn ntt_polynomial_addition() {
    let p1 = make_test_ntt_polynomial::<KyberField>(100);
    let p2 = make_test_ntt_polynomial::<KyberField>(200);
    let sum = &p1 + &p2;

    assert_eq!(sum.0[0].0, 300);
    assert_eq!(sum.0[1].0, 302);
}

#[test]
fn ntt_polynomial_subtraction() {
    let p1 = make_test_ntt_polynomial::<KyberField>(300);
    let p2 = make_test_ntt_polynomial::<KyberField>(100);
    let diff = &p1 - &p2;

    assert_eq!(diff.0[0].0, 200);
}

#[test]
fn ntt_polynomial_negation() {
    let p = make_test_ntt_polynomial::<KyberField>(100);
    let neg_p = -&p;

    assert_eq!(neg_p.0[0].0, 3229); // -100 mod 3329
}

#[test]
fn ntt_polynomial_scalar_multiplication() {
    let p = make_test_ntt_polynomial::<KyberField>(100);
    let scalar: Elem<KyberField> = Elem::new(3);
    let scaled = scalar * &p;

    assert_eq!(scaled.0[0].0, 300);
}

#[test]
fn ntt_polynomial_from_array() {
    use array::Array;

    let coeffs: Array<Elem<KyberField>, array::typenum::U256> =
        core::array::from_fn(|i| Elem::new((i % 3329) as u16)).into();
    let p: NttPolynomial<KyberField> = coeffs.into();

    assert_eq!(p.0[0].0, 0);
    assert_eq!(p.0[1].0, 1);

    // Convert back
    let arr: Array<Elem<KyberField>, array::typenum::U256> = p.into();
    assert_eq!(arr[0].0, coeffs[0].0);
}

// ========================================
// NttVector<F, K> arithmetic tests
// ========================================

fn make_test_ntt_vector<F: Field>(base: F::Int) -> NttVector<F, U2>
where
    F::Int: From<u8>,
{
    let p1 = make_test_ntt_polynomial::<F>(base);
    let p2 = make_test_ntt_polynomial::<F>(base + F::Int::from(50u8));
    NttVector::new([p1, p2].into())
}

#[test]
fn ntt_vector_addition() {
    let v1 = make_test_ntt_vector::<KyberField>(100);
    let v2 = make_test_ntt_vector::<KyberField>(200);
    let sum = &v1 + &v2;

    assert_eq!(sum.0[0].0[0].0, 300);
    assert_eq!(sum.0[1].0[0].0, 400);
}

#[test]
fn ntt_vector_subtraction() {
    let v1 = make_test_ntt_vector::<KyberField>(300);
    let v2 = make_test_ntt_vector::<KyberField>(100);
    let diff = &v1 - &v2;

    assert_eq!(diff.0[0].0[0].0, 200);
    assert_eq!(diff.0[1].0[0].0, 200);
}

// ========================================
// PartialEq tests (to catch == vs != mutations)
// ========================================

#[test]
fn elem_equality() {
    let a: Elem<KyberField> = Elem::new(100);
    let b: Elem<KyberField> = Elem::new(100);
    let c: Elem<KyberField> = Elem::new(200);

    assert_eq!(a, b);
    assert_ne!(a, c);
}

#[test]
fn polynomial_equality() {
    let p1 = make_test_polynomial::<KyberField>(100);
    let p2 = make_test_polynomial::<KyberField>(100);
    let p3 = make_test_polynomial::<KyberField>(200);

    assert_eq!(p1, p2);
    assert_ne!(p1, p3);
}

#[test]
fn vector_equality() {
    let v1 = make_test_vector::<KyberField>(100);
    let v2 = make_test_vector::<KyberField>(100);
    let v3 = make_test_vector::<KyberField>(200);

    assert_eq!(v1, v2);
    assert_ne!(v1, v3);
}

#[test]
fn ntt_polynomial_equality() {
    let p1 = make_test_ntt_polynomial::<KyberField>(100);
    let p2 = make_test_ntt_polynomial::<KyberField>(100);
    let p3 = make_test_ntt_polynomial::<KyberField>(200);

    assert_eq!(p1, p2);
    assert_ne!(p1, p3);
}

#[test]
fn ntt_vector_equality() {
    let v1 = make_test_ntt_vector::<KyberField>(100);
    let v2 = make_test_ntt_vector::<KyberField>(100);
    let v3 = make_test_ntt_vector::<KyberField>(200);

    assert_eq!(v1, v2);
    assert_ne!(v1, v3);
}

#[test]
fn ntt_matrix_equality() {
    let v1 = make_test_ntt_vector::<KyberField>(100);
    let v2 = make_test_ntt_vector::<KyberField>(150);
    let m1: NttMatrix<KyberField, U2, U2> = NttMatrix::new([v1.clone(), v2.clone()].into());
    let m2: NttMatrix<KyberField, U2, U2> = NttMatrix::new([v1.clone(), v2.clone()].into());

    let v3 = make_test_ntt_vector::<KyberField>(200);
    let m3: NttMatrix<KyberField, U2, U2> = NttMatrix::new([v1, v3].into());

    assert_eq!(m1, m2);
    assert_ne!(m1, m3);
}

#[test]
fn ntt_polynomial_into_array() {
    use array::Array;
    use array::typenum::U256;

    let p = make_test_ntt_polynomial::<KyberField>(100);

    // Convert to array and verify contents match
    let arr: Array<Elem<KyberField>, U256> = p.clone().into();
    assert_eq!(arr[0].0, 100);
    assert_eq!(arr[1].0, 101);
    assert_eq!(arr[9].0, 109);
    assert_eq!(arr[10].0, 0);

    // Verify conversion preserves all data
    for i in 0..256 {
        assert_eq!(arr[i].0, p.0[i].0);
    }
}

// ========================================
// Zeroize tests (require zeroize feature)
// ========================================

#[cfg(feature = "zeroize")]
mod zeroize_tests {
    use super::*;
    use zeroize::Zeroize;

    #[test]
    fn elem_zeroize() {
        let mut a: Elem<KyberField> = Elem::new(1234);
        assert_ne!(a.0, 0);
        a.zeroize();
        assert_eq!(a.0, 0);
    }

    #[test]
    fn polynomial_zeroize() {
        let mut p = make_test_polynomial::<KyberField>(100);
        assert_ne!(p.0[0].0, 0);
        p.zeroize();
        for i in 0..256 {
            assert_eq!(p.0[i].0, 0, "Coefficient {} not zeroed", i);
        }
    }

    #[test]
    fn vector_zeroize() {
        let mut v = make_test_vector::<KyberField>(100);
        assert_ne!(v.0[0].0[0].0, 0);
        v.zeroize();
        for i in 0..2 {
            for j in 0..256 {
                assert_eq!(v.0[i].0[j].0, 0, "Element [{i}][{j}] not zeroed");
            }
        }
    }

    #[test]
    fn ntt_polynomial_zeroize() {
        let mut p = make_test_ntt_polynomial::<KyberField>(100);
        assert_ne!(p.0[0].0, 0);
        p.zeroize();
        for i in 0..256 {
            assert_eq!(p.0[i].0, 0, "Coefficient {} not zeroed", i);
        }
    }

    #[test]
    fn ntt_vector_zeroize() {
        let mut v = make_test_ntt_vector::<KyberField>(100);
        assert_ne!(v.0[0].0[0].0, 0);
        v.zeroize();
        for i in 0..2 {
            for j in 0..256 {
                assert_eq!(v.0[i].0[j].0, 0, "Element [{i}][{j}] not zeroed");
            }
        }
    }
}

/// `CtEq` tests (requires `ctutils` feature)
#[cfg(feature = "ctutils")]
mod ctutils_tests {
    use super::*;
    use ctutils::CtEq;

    #[test]
    fn elem_ct_eq() {
        let a: Elem<KyberField> = Elem::new(100);
        let b: Elem<KyberField> = Elem::new(100);
        let c: Elem<KyberField> = Elem::new(200);

        assert!(bool::from(a.ct_eq(&b)));
        assert!(!bool::from(a.ct_eq(&c)));
    }

    #[test]
    fn ntt_polynomial_ct_eq() {
        let p1 = make_test_ntt_polynomial::<KyberField>(100);
        let p2 = make_test_ntt_polynomial::<KyberField>(100);
        let p3 = make_test_ntt_polynomial::<KyberField>(200);

        assert!(bool::from(p1.ct_eq(&p2)));
        assert!(!bool::from(p1.ct_eq(&p3)));
    }
}
