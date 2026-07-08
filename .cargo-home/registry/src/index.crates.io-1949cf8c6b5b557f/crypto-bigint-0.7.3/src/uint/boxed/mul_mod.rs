//! [`BoxedUint`] modular multiplication operations.

use crate::{
    BoxedUint, ConcatenatingMul, ConcatenatingSquare, Limb, MulMod, NonZero, SquareMod, UintRef,
    div_limb::mul_rem,
};

impl BoxedUint {
    /// Computes `self * rhs mod p` for non-zero `p`.
    #[must_use]
    pub fn mul_mod(&self, rhs: &BoxedUint, p: &NonZero<BoxedUint>) -> BoxedUint {
        self.concatenating_mul(rhs).rem(p)
    }

    /// Computes `self * rhs mod p` for the special modulus
    /// `p = MAX+1-c` where `c` is small enough to fit in a single [`Limb`].
    ///
    /// For the modulus reduction, this function implements Algorithm 14.47 from
    /// the "Handbook of Applied Cryptography", by A. Menezes, P. van Oorschot,
    /// and S. Vanstone, CRC Press, 1996.
    #[must_use]
    pub fn mul_mod_special(&self, rhs: &Self, c: Limb) -> Self {
        debug_assert_eq!(self.bits_precision(), rhs.bits_precision());

        if self.nlimbs() == 1 {
            let reduced = mul_rem(
                self.limbs[0],
                rhs.limbs[0],
                NonZero::<Limb>::new_unwrap(Limb::ZERO.wrapping_sub(c)),
            );
            return Self::from(reduced);
        }

        let product = self.concatenating_mul(rhs);
        let (lo, hi) = product.as_uint_ref().split_at(self.nlimbs());

        // Now use Algorithm 14.47 for the reduction
        let (mut lo, carry) = mac_by_limb(lo, hi, c, Limb::ZERO);

        let carry = {
            let rhs = carry.wrapping_add(Limb::ONE).widening_mul(c);
            lo.carrying_add_assign(UintRef::new(&[rhs.0, rhs.1]), Limb::ZERO)
        };

        {
            let rhs = carry.wrapping_sub(Limb::ONE) & c;
            lo.borrowing_sub_assign(rhs, Limb::ZERO);
        }

        lo
    }

    /// Computes `self * self mod p`.
    #[must_use]
    pub fn square_mod(&self, p: &NonZero<BoxedUint>) -> Self {
        self.concatenating_square().rem(p)
    }

    /// Computes `self * self mod p` in variable time with respect to `p`.
    #[must_use]
    pub fn square_mod_vartime(&self, p: &NonZero<BoxedUint>) -> Self {
        self.concatenating_square().rem_vartime(p)
    }
}

impl MulMod for BoxedUint {
    type Output = Self;

    fn mul_mod(&self, rhs: &Self, p: &NonZero<Self>) -> Self {
        self.mul_mod(rhs, p)
    }
}

impl SquareMod for BoxedUint {
    type Output = Self;

    fn square_mod(&self, p: &NonZero<Self>) -> Self {
        self.square_mod(p)
    }
}

/// Computes `a + (b * c) + carry`, returning the result along with the new carry.
fn mac_by_limb(a: &UintRef, b: &UintRef, c: Limb, carry: Limb) -> (BoxedUint, Limb) {
    let mut res = BoxedUint::zero_with_precision(a.bits_precision());
    let mut carry = carry;

    for i in 0..a.nlimbs() {
        (res.limbs[i], carry) = b.limbs[i].carrying_mul_add(c, a.limbs[i], carry);
    }

    (res, carry)
}

#[cfg(all(test, feature = "rand_core"))]
mod tests {
    use crate::{BoxedUint, ConcatenatingMul, Limb, NonZero, Random, RandomMod};
    use rand_core::SeedableRng;

    #[test]
    fn mul_mod_special() {
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
                    (&one, &zero, &zero),
                    (&zero, &one, &zero),
                    (&one, &one, &one),
                    (&minus_one, &minus_one, &one),
                    (&minus_one, &one, &minus_one),
                    (&one, &minus_one, &minus_one),
                ];
                for (a, b, c) in base_cases {
                    let x = a.mul_mod_special(b, *special.as_ref());
                    assert_eq!(&x, c, "{} * {} mod {} = {} != {}", a, b, p, x, c);
                }

                for _i in 0..100 {
                    let a = BoxedUint::random_mod_vartime(&mut rng, &p);
                    let b = BoxedUint::random_mod_vartime(&mut rng, &p);

                    let c = a.mul_mod_special(&b, *special.as_ref());
                    assert!(c < p.as_ref(), "not reduced: {} >= {} ", c, p);

                    let expected = {
                        let prod = a.concatenating_mul(&b);
                        prod.rem_vartime(&p)
                    };
                    assert_eq!(c, expected, "incorrect result");
                }
            }
        }
    }
}
