//! [`BoxedUint`] modular addition operations.

use crate::{AddMod, BoxedUint, Limb, NonZero};

impl BoxedUint {
    /// Computes `self + rhs mod p`.
    ///
    /// Assumes `self + rhs` as unbounded integer is `< 2p`.
    #[must_use]
    pub fn add_mod(&self, rhs: &Self, p: &NonZero<Self>) -> Self {
        let mut result = self.clone();
        result.add_mod_assign(rhs, p);
        result
    }

    /// Computes `self + rhs mod p` and writes the result in `self`.
    ///
    /// Assumes `self + rhs` as unbounded integer is `< 2p`.
    pub fn add_mod_assign(&mut self, rhs: &Self, p: &NonZero<Self>) {
        debug_assert_eq!(self.bits_precision(), p.bits_precision());
        debug_assert_eq!(rhs.bits_precision(), p.bits_precision());
        debug_assert!(*self < p.as_ref());
        debug_assert!(rhs < p.as_ref());

        let carry = self.carrying_add_assign(rhs, Limb::ZERO);
        self.sub_assign_mod_with_carry(carry, p, p);
    }

    /// Computes `self + self mod p`.
    ///
    /// Assumes `self` as unbounded integer is `< p`.
    #[must_use]
    pub fn double_mod(&self, p: &NonZero<Self>) -> Self {
        let (mut w, carry) = self.shl1();
        w.sub_assign_mod_with_carry(carry, p, p);
        w
    }

    /// Computes `self + rhs mod p` for the special modulus
    /// `p = MAX+1-c` where `c` is small enough to fit in a single [`Limb`].
    ///
    /// Assumes `self + rhs` as unbounded integer is `< 2p`.
    #[must_use]
    pub fn add_mod_special(&self, rhs: &Self, c: Limb) -> Self {
        // `BoxedUint::carrying_add` also works with a carry greater than 1.
        let (mut out, carry) = self.carrying_add(rhs, c);

        // If overflow occurred, then above addition of `c` already accounts
        // for the overflow. Otherwise, we need to subtract `c` again, which
        // in that case cannot underflow.
        let l = carry.wrapping_sub(Limb::ONE) & c;
        out.wrapping_sub_assign(l);
        out
    }
}

impl AddMod for BoxedUint {
    type Output = Self;

    fn add_mod(&self, rhs: &Self, p: &NonZero<Self>) -> Self {
        self.add_mod(rhs, p)
    }
}

#[cfg(test)]
mod tests {
    use super::BoxedUint;
    use hex_literal::hex;

    #[cfg(feature = "rand_core")]
    use crate::{Limb, NonZero, Random, RandomMod};
    #[cfg(feature = "rand_core")]
    use rand_core::SeedableRng;

    // TODO(tarcieri): proptests

    #[test]
    fn add_mod_nist_p256() {
        let a = BoxedUint::from_be_slice(
            &hex!("44acf6b7e36c1342c2c5897204fe09504e1e2efb1a900377dbc4e7a6a133ec56"),
            256,
        )
        .unwrap();
        let b = BoxedUint::from_be_slice(
            &hex!("d5777c45019673125ad240f83094d4252d829516fac8601ed01979ec1ec1a251"),
            256,
        )
        .unwrap();
        let n = BoxedUint::from_be_slice(
            &hex!("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),
            256,
        )
        .unwrap()
        .to_nz()
        .unwrap();

        let actual = a.add_mod(&b, &n);
        let expected = BoxedUint::from_be_slice(
            &hex!("1a2472fde50286541d97ca6a3592dd75beb9c9646e40c511b82496cfc3926956"),
            256,
        )
        .unwrap();

        assert_eq!(expected, actual);
    }

    #[test]
    fn double_mod_expected() {
        let a = BoxedUint::from_be_hex(
            "44acf6b7e36c1342c2c5897204fe09504e1e2efb1a900377dbc4e7a6a133ec56",
            256,
        )
        .unwrap();
        let n = BoxedUint::from_be_hex(
            "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
            256,
        )
        .unwrap()
        .to_nz()
        .unwrap();

        assert_eq!(a.add_mod(&a, &n), a.double_mod(&n));
    }

    #[test]
    #[cfg(feature = "rand_core")]
    fn add_mod_special() {
        let mut rng = chacha20::ChaCha8Rng::seed_from_u64(1);
        let moduli = [
            NonZero::<Limb>::random_from_rng(&mut rng),
            NonZero::<Limb>::random_from_rng(&mut rng),
        ];
        let sizes = if cfg!(miri) {
            &[1, 2, 3][..]
        } else {
            &[1, 2, 3, 4, 8, 16][..]
        };

        for size in sizes.iter().copied() {
            let bits = size * Limb::BITS;

            for special in &moduli {
                let zero = BoxedUint::zero_with_precision(bits);
                let one = BoxedUint::one_with_precision(bits);
                let p = NonZero::new(zero.wrapping_sub(special.get())).unwrap();
                let minus_one = p.wrapping_sub(Limb::ONE);

                let base_cases = [
                    (&zero, &zero, &zero),
                    (&one, &zero, &one),
                    (&zero, &one, &one),
                    (&minus_one, &one, &zero),
                    (&one, &minus_one, &zero),
                ];

                for (a, b, c) in base_cases {
                    let x = a.add_mod_special(b, *special.as_ref());
                    assert_eq!(&x, c, "{} - {} mod {} = {} != {}", a, b, p, x, c);
                }

                for _i in 0..100 {
                    let a = BoxedUint::random_mod_vartime(&mut rng, &p);
                    let b = BoxedUint::random_mod_vartime(&mut rng, &p);

                    let c = a.add_mod_special(&b, *special.as_ref());
                    assert!(c < *p, "not reduced: {} >= {} ", c, p);

                    let expected = a.add_mod(&b, &p);
                    assert_eq!(c, expected, "incorrect result");
                }
            }
        }
    }
}
