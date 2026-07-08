//! Equivalence tests between `crypto_bigint::MontyForm` and `num-bigint`.

#![cfg(any(unix, windows))]
#![allow(clippy::integer_division_remainder_used, reason = "test")]

mod common;

use common::to_biguint;
use crypto_bigint::{
    Bounded, Constants, CtOption, EncodedUint, Encoding, Integer, Invert, MontyForm, NonZero, Odd,
    U128, U256, U512, U1024, U2048, U4096, UnsignedWithMontyForm,
    modular::{FixedMontyForm, FixedMontyParams},
};
use num_bigint::BigUint;
use num_modular::ModularUnaryOps;
use num_traits::FromBytes;
use prop::test_runner::TestRng;
use proptest::prelude::*;

type MontyForm256 = FixedMontyForm<{ U256::LIMBS }>;
type MontyParams256 = FixedMontyParams<{ U256::LIMBS }>;

fn retrieve_biguint(monty_form: &MontyForm256) -> BigUint {
    to_biguint(&monty_form.retrieve())
}

fn reduce(n: &U256, p: MontyParams256) -> MontyForm256 {
    let n_reduced = n.rem_vartime(p.modulus().as_nz_ref());
    MontyForm256::new(&n_reduced, &p)
}

prop_compose! {
    fn uint()(bytes in any::<[u8; 32]>()) -> U256 {
        U256::from_le_slice(&bytes)
    }
}
prop_compose! {
    /// Generate a random odd modulus.
    fn modulus()(mut n in uint()) -> MontyParams256 {
        if n.is_even().into() {
            n = n.wrapping_add(&U256::ONE);
        }

        MontyParams256::new_vartime(Odd::new(n).expect("modulus ensured odd"))
    }
}
// Generates a random `T` and returns it as a tuple in: normal form, montgomery form,
// inverted montgomery form and the normal form inverse from the num_modular crate.
fn random_invertible_uint<T>(
    bytes: T::Repr,
    monty_params: <<T as UnsignedWithMontyForm>::MontyForm as MontyForm>::Params,
    modulus: T,
) -> Result<
    (
        T,
        <T as UnsignedWithMontyForm>::MontyForm,
        <T as UnsignedWithMontyForm>::MontyForm,
        BigUint,
    ),
    TestCaseError,
>
where
    T: UnsignedWithMontyForm + Bounded + Encoding,
    <T as UnsignedWithMontyForm>::MontyForm: Invert<Output = CtOption<T::MontyForm>>,
{
    let r = T::from_be_bytes(bytes.clone());
    let rm = <T as UnsignedWithMontyForm>::MontyForm::new(r.clone(), &monty_params);
    let rm_inv = rm.invert();
    prop_assume!(bool::from(rm_inv.is_some()), "r={:?} is not invertible", r);
    let num_modular_modulus = BigUint::from_be_bytes(modulus.to_be_bytes().as_ref());
    let num_modular_inverse = BigUint::from_be_bytes(bytes.as_ref())
        .clone()
        .invm(&num_modular_modulus)
        .unwrap();

    Ok((r, rm, rm_inv.unwrap(), num_modular_inverse))
}

// Given two bytes, presumed to be random, construct edge-case MontyParams with the first, last or
// middle bytes set to the edge case bytes.
fn monty_params_from_edge<T>(
    edge_bytes: [u8; 2],
    rng: &mut TestRng,
) -> <<T as UnsignedWithMontyForm>::MontyForm as MontyForm>::Params
where
    T: UnsignedWithMontyForm + Constants + Encoding,
{
    let mut bytes = T::MAX.to_be_bytes();
    let len = bytes.as_ref().len();
    let edge = match rng.random_range(0..3) {
        // Hi
        0 => (len - 2)..len,
        // Mid
        1 => len / 2 - 1..len / 2 + 1,
        // Lo
        2 => 0..2,
        _ => unimplemented!("shut up rust"),
    };
    bytes.as_mut()[edge].copy_from_slice(&edge_bytes);
    let mut modulus = T::from_be_bytes(bytes);
    modulus.set_bit_vartime(0, true);
    <T as UnsignedWithMontyForm>::MontyForm::new_params_vartime(Odd::new(modulus).unwrap())
}

prop_compose! {
    fn random_invertible_u128()(
        bytes in any::<[u8; U128::BYTES]>(),
        monty_params in any::<[u8;2]>().prop_perturb(|edge_bytes, mut rng|{
            monty_params_from_edge::<U128>(edge_bytes, &mut rng)
        })
    ) -> Result<(U128, <U128 as UnsignedWithMontyForm>::MontyForm , <U128 as UnsignedWithMontyForm>::MontyForm, BigUint),TestCaseError> {
        random_invertible_uint(EncodedUint::try_from(bytes.as_ref()).unwrap(), monty_params, monty_params.modulus().get())
    }
}
prop_compose! {
    fn random_invertible_u256()(
        bytes in any::<[u8; U256::BYTES]>(),
        monty_params in any::<[u8;2]>().prop_perturb(|edge_bytes, mut rng|{
            monty_params_from_edge::<U256>(edge_bytes, &mut rng)
        })
    ) -> Result<(U256, <U256 as UnsignedWithMontyForm>::MontyForm , <U256 as UnsignedWithMontyForm>::MontyForm, BigUint),TestCaseError> {
        random_invertible_uint(EncodedUint::try_from(bytes.as_ref()).unwrap(), monty_params, monty_params.modulus().get())
    }
}
prop_compose! {
    fn random_invertible_u2048()(
        bytes in any::<[u8; U2048::BYTES]>(),
        monty_params in any::<[u8;2]>().prop_perturb(|edge_bytes, mut rng|{
            monty_params_from_edge::<U2048>(edge_bytes, &mut rng)
        })
    ) -> Result<(U2048, <U2048 as UnsignedWithMontyForm>::MontyForm , <U2048 as UnsignedWithMontyForm>::MontyForm, BigUint),TestCaseError> {
        random_invertible_uint(EncodedUint::try_from(bytes.as_ref()).unwrap(), monty_params, monty_params.modulus().get())
    }
}
prop_compose! {
    fn random_invertible_u1024()(
        bytes in any::<[u8; U1024::BYTES]>(),
        monty_params in any::<[u8;2]>().prop_perturb(|edge_bytes, mut rng|{
            monty_params_from_edge::<U1024>(edge_bytes, &mut rng)
        })
    ) -> Result<(U1024, <U1024 as UnsignedWithMontyForm>::MontyForm, <U1024 as UnsignedWithMontyForm>::MontyForm, BigUint),TestCaseError> {
        random_invertible_uint(EncodedUint::try_from(bytes.as_ref()).unwrap(), monty_params, monty_params.modulus().get())
    }
}
proptest! {
    #[test]
    fn inversion_u128(
        inputs in random_invertible_u128(),
    ) {
        let (r,r_monty, r_monty_inv, r_num_modular_inv) = inputs?;
        let monty_params = r_monty.params();
        let one_monty = r_monty * r_monty_inv;
        // Inversion works in monty form
        assert_eq!(
            one_monty,
            FixedMontyForm::one(monty_params),
            "a*a⁻¹ ≠ 1 (monty form)\nmodulus: {:0128b}",
            monty_params.modulus()
        );
        // …and in normal form
        assert_eq!(one_monty.retrieve(), U128::ONE, "a*a⁻¹ ≠ 1 (normal form)");
        // …and when converted back to normal form and used in a widening operation
        let wide_modulus = NonZero::new(Into::<U256>::into(&monty_params.modulus().get())).unwrap();
        let one = r_monty_inv.retrieve().concatenating_mul(&r);
        assert_eq!(
            one % wide_modulus,
            U256::ONE,
            "a*a⁻¹ ≠ 1 (normal form, wide)"
        );
        // …and agrees with normal form inversion
        let normal_form_inv = r.invert_mod(monty_params.modulus().as_nz_ref()).unwrap();
        assert_eq!(
            normal_form_inv,
            r_monty_inv.retrieve(),
            "a*a⁻¹ ≠ 1 (normal form inverted)"
        );
        // …and agrees with the num_modular crate
        assert_eq!(
            BigUint::from_be_bytes(normal_form_inv.to_be_bytes().as_ref()),
            r_num_modular_inv,
            "num_modular ≠ crypto_bigint"
        );
    }

    #[test]
    fn inversion_u256(
        inputs in random_invertible_u256(),
    ) {
        let (r,r_monty, r_monty_inv, r_num_modular_inv) = inputs?;
        let monty_params = r_monty.params();
        let one_monty = r_monty * r_monty_inv;
        // Inversion works in monty form
        assert_eq!(
            one_monty,
            FixedMontyForm::one(monty_params),
            "a*a⁻¹ ≠ 1 (monty form)\nmodulus: {:0256b}",
            monty_params.modulus()
        );
        // …and in normal form
        assert_eq!(one_monty.retrieve(), U256::ONE, "a*a⁻¹ ≠ 1 (normal form)");
        // …and when converted back to normal form and used in a widening operation
        let wide_modulus = NonZero::new(Into::<U512>::into(&monty_params.modulus().get())).unwrap();
        let one = r_monty_inv.retrieve().concatenating_mul(&r);
        assert_eq!(
            one % wide_modulus,
            U512::ONE,
            "a*a⁻¹ ≠ 1 (normal form, wide)"
        );
        // …and agrees with normal form inversion
        let normal_form_inv = r.invert_mod(monty_params.modulus().as_nz_ref()).unwrap();
        assert_eq!(
            normal_form_inv,
            r_monty_inv.retrieve(),
            "a*a⁻¹ ≠ 1 (normal form inverted)"
        );
        // …and agrees with the num_modular crate
        assert_eq!(
            BigUint::from_be_bytes(normal_form_inv.to_be_bytes().as_ref()),
            r_num_modular_inv,
            "num_modular ≠ crypto_bigint"
        );
    }

    #[test]
    fn inversion_u1024(
        inputs in random_invertible_u1024(),
    ) {
        let (r,r_monty, r_monty_inv, r_num_modular_inv) = inputs?;
        let monty_params = r_monty.params();
        let one_monty = r_monty * r_monty_inv;
        // Inversion works in monty form
        assert_eq!(
            one_monty,
            FixedMontyForm::one(monty_params),
            "a*a⁻¹ ≠ 1 (monty form)\nmodulus: {:01024b}",
            monty_params.modulus()
        );
        // …and in normal form
        assert_eq!(one_monty.retrieve(), U1024::ONE, "a*a⁻¹ ≠ 1 (normal form)");
        // …and when converted back to normal form and used in a widening operation
        let wide_modulus = NonZero::new(Into::<U2048>::into(&monty_params.modulus().get())).unwrap();
        let one = r_monty_inv.retrieve().concatenating_mul(&r);
        assert_eq!(
            one % wide_modulus,
            U2048::ONE,
            "a*a⁻¹ ≠ 1 (normal form, wide)"
        );
        // …and agrees with normal form inversion
        let normal_form_inv = r.invert_mod(monty_params.modulus().as_nz_ref()).unwrap();
        assert_eq!(
            normal_form_inv,
            r_monty_inv.retrieve(),
            "a*a⁻¹ ≠ 1 (normal form inverted)"
        );
        // …and agrees with the num_modular crate
        assert_eq!(
            BigUint::from_be_bytes(normal_form_inv.to_be_bytes().as_ref()),
            r_num_modular_inv,
            "num_modular ≠ crypto_bigint"
        );
    }

    #[test]
    fn inversion_u2048(
        inputs in random_invertible_u2048(),
    ) {
        let (r,r_monty, r_monty_inv, r_num_modular_inv) = inputs?;
        let monty_params = r_monty.params();
        let one_monty = r_monty * r_monty_inv;
        // Inversion works in monty form
        assert_eq!(
            one_monty,
            FixedMontyForm::one(monty_params),
            "a*a⁻¹ ≠ 1 (monty form)\nmodulus: {:02048b}",
            monty_params.modulus()
        );
        // …and in normal form
        assert_eq!(one_monty.retrieve(), U2048::ONE, "a*a⁻¹ ≠ 1 (normal form)");
        // …and when converted back to normal form and used in a widening operation
        let wide_modulus = NonZero::new(Into::<U4096>::into(&monty_params.modulus().get())).unwrap();
        let one = r_monty_inv.retrieve().concatenating_mul(&r);
        assert_eq!(
            one % wide_modulus,
            U4096::ONE,
            "a*a⁻¹ ≠ 1 (normal form, wide)"
        );
        // …and agrees with normal form inversion
        let normal_form_inv = r.invert_mod(monty_params.modulus().as_nz_ref()).unwrap();
        assert_eq!(
            normal_form_inv,
            r_monty_inv.retrieve(),
            "a*a⁻¹ ≠ 1 (normal form inverted)"
        );
        // …and agrees with the num_modular crate
        assert_eq!(
            BigUint::from_be_bytes(normal_form_inv.to_be_bytes().as_ref()),
            r_num_modular_inv,
            "num_modular ≠ crypto_bigint"
        );
    }

    #[test]
    fn new(n in modulus()) {
        let n2 = MontyParams256::new(*n.modulus());
        prop_assert_eq!(n, n2);
    }

    #[test]
    fn add(x in uint(), y in uint(), n in modulus()) {
        let x = reduce(&x, n);
        let y = reduce(&y, n);
        let actual = x + y;

        let x_bi = retrieve_biguint(&x);
        let y_bi = retrieve_biguint(&y);
        let n_bi = to_biguint(n.modulus());
        let expected = (x_bi + y_bi) % n_bi;

        prop_assert_eq!(retrieve_biguint(&actual), expected);
    }

    #[test]
    fn sub(x in uint(), y in uint(), n in modulus()) {
        let x = reduce(&x, n);
        let y = reduce(&y, n);
        let actual = x - y;

        let x_bi = retrieve_biguint(&x);
        let y_bi = retrieve_biguint(&y);
        let n_bi = to_biguint(n.modulus());
        let expected = if x_bi >= y_bi {
            (x_bi - y_bi) % &n_bi
        } else {
            (&n_bi - (y_bi - x_bi)) % &n_bi
        };

        prop_assert_eq!(retrieve_biguint(&actual), expected);
    }

    #[test]
    fn double(x in uint(),  n in modulus()) {
        let x = reduce(&x, n);
        let actual = x.double();

        let x_bi = retrieve_biguint(&x);
        let n_bi = to_biguint(n.modulus());
        let expected = (x_bi << 1) % n_bi;

        prop_assert_eq!(retrieve_biguint(&actual), expected);
    }

    #[test]
    fn mul(x in uint(), y in uint(), n in modulus()) {
        let x = reduce(&x, n);
        let y = reduce(&y, n);
        let actual = x * y;

        let x_bi = retrieve_biguint(&x);
        let y_bi = retrieve_biguint(&y);
        let n_bi = to_biguint(n.modulus());
        let expected = (x_bi * y_bi) % n_bi;

        prop_assert_eq!(retrieve_biguint(&actual), expected);
    }

    #[test]
    fn square(x in uint(), n in modulus()) {
        let x = reduce(&x, n);
        let actual = x.square();

        let x_bi = retrieve_biguint(&x);
        let n_bi = to_biguint(n.modulus());
        let expected = x_bi.sqm(&n_bi);

        prop_assert_eq!(retrieve_biguint(&actual), expected);
    }

    #[test]
    fn invert(x in uint(), n in modulus()) {
        let x = reduce(&x, n);
        let actual = Option::<MontyForm256>::from(x.invert());

        let x_bi = retrieve_biguint(&x);
        let n_bi = to_biguint(n.modulus());
        let expected = x_bi.invm(&n_bi);

        match (expected, actual) {
            (Some(exp), Some(act)) => {
                let res = x * act;
                prop_assert_eq!(res.retrieve(), U256::ONE);
                prop_assert_eq!(exp, retrieve_biguint(&act));
            }
            (None, None) => (),
            (_, _) => panic!("disagreement on if modular inverse exists")
        }
    }

    #[test]
    fn pow(x in uint(), y in uint(), n in modulus()) {
        let x = reduce(&x, n);
        let actual = x.pow(&y);
        let actual_vartime = x.pow_vartime(&y);

        let x_bi = retrieve_biguint(&x);
        let y_bi = to_biguint(&y);
        let n_bi = to_biguint(n.modulus());
        let expected = x_bi.modpow(&y_bi, &n_bi);

        prop_assert_eq!(&retrieve_biguint(&actual), &expected);
        prop_assert_eq!(retrieve_biguint(&actual_vartime), expected);
    }

    #[test]
    fn pow_amm(x in uint(), y in uint(), n in modulus()) {
        let x = reduce(&x, n);
        let actual = x.pow_amm(&y);

        let x_bi = retrieve_biguint(&x);
        let y_bi = to_biguint(&y);
        let n_bi = to_biguint(n.modulus());
        let expected = x_bi.modpow(&y_bi, &n_bi);

        prop_assert_eq!(&retrieve_biguint(&actual), &expected);
    }

    #[test]
    fn div_by_2(x in uint(), n in modulus()) {
        let x = reduce(&x, n);
        let actual = x.div_by_2();

        let x_bi = retrieve_biguint(&x);
        let n_bi = to_biguint(n.modulus());
        let expected = if x.retrieve().is_odd().into() {
            (x_bi + n_bi) >> 1
        }
        else {
            x_bi >> 1
        };

        prop_assert_eq!(&retrieve_biguint(&actual), &expected);
    }
}
