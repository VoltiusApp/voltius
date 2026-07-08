//! [`Uint`] modular multiplication operations.

use crate::{Limb, MulMod, NonZero, SquareMod, Uint, WideWord, Word, div_limb::mul_rem};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Computes `self * rhs mod p`.
    #[must_use]
    pub fn mul_mod(&self, rhs: &Uint<LIMBS>, p: &NonZero<Uint<LIMBS>>) -> Uint<LIMBS> {
        let lo_hi = self.widening_mul(rhs);
        Self::rem_wide(lo_hi, p)
    }

    /// Computes `self * rhs mod p` in variable time with respect to `p`.
    #[must_use]
    pub fn mul_mod_vartime(&self, rhs: &Uint<LIMBS>, p: &NonZero<Uint<LIMBS>>) -> Uint<LIMBS> {
        let lo_hi = self.widening_mul(rhs);
        Self::rem_wide_vartime(lo_hi, p)
    }

    /// Computes `self * rhs mod p` for the special modulus
    /// `p = MAX+1-c` where `c` is small enough to fit in a single [`Limb`].
    ///
    /// For the modulus reduction, this function implements Algorithm 14.47 from
    /// the "Handbook of Applied Cryptography", by A. Menezes, P. van Oorschot,
    /// and S. Vanstone, CRC Press, 1996.
    #[must_use]
    pub const fn mul_mod_special(&self, rhs: &Self, c: Limb) -> Self {
        // We implicitly assume `LIMBS > 0`, because `Uint<0>` doesn't compile.
        // Still the case `LIMBS == 1` needs special handling.
        if LIMBS == 1 {
            let reduced = mul_rem(
                self.limbs[0],
                rhs.limbs[0],
                NonZero::<Limb>::new_unwrap(Limb(Word::MIN.wrapping_sub(c.0))),
            );
            return Self::from_word(reduced.0);
        }

        let (lo, hi) = self.widening_mul(rhs);

        // Now use Algorithm 14.47 for the reduction
        let (lo, carry) = mac_by_limb(&lo, &hi, c, Limb::ZERO);

        let (lo, carry) = {
            let rhs = (carry.0 + 1) as WideWord * c.0 as WideWord;
            lo.carrying_add(&Self::from_wide_word(rhs), Limb::ZERO)
        };

        let (lo, _) = {
            let rhs = carry.0.wrapping_sub(1) & c.0;
            lo.borrowing_sub(&Self::from_word(rhs), Limb::ZERO)
        };

        lo
    }

    /// Computes `self * self mod p`.
    #[must_use]
    pub const fn square_mod(&self, p: &NonZero<Uint<LIMBS>>) -> Self {
        let lo_hi = self.widening_square();
        Self::rem_wide(lo_hi, p)
    }

    /// Computes `self * self mod p` in variable time with respect to `p`.
    #[must_use]
    pub const fn square_mod_vartime(&self, p: &NonZero<Uint<LIMBS>>) -> Self {
        let lo_hi = self.widening_square();
        Self::rem_wide_vartime(lo_hi, p)
    }
}

impl<const LIMBS: usize> MulMod for Uint<LIMBS> {
    type Output = Self;

    fn mul_mod(&self, rhs: &Self, p: &NonZero<Self>) -> Self {
        self.mul_mod(rhs, p)
    }
}

impl<const LIMBS: usize> SquareMod for Uint<LIMBS> {
    type Output = Self;

    fn square_mod(&self, p: &NonZero<Self>) -> Self {
        self.square_mod(p)
    }
}

/// Computes `a + (b * c) + carry`, returning the result along with the new carry.
const fn mac_by_limb<const LIMBS: usize>(
    a: &Uint<LIMBS>,
    b: &Uint<LIMBS>,
    c: Limb,
    carry: Limb,
) -> (Uint<LIMBS>, Limb) {
    let mut i = 0;
    let mut a = *a;
    let mut carry = carry;

    while i < LIMBS {
        (a.limbs[i], carry) = b.limbs[i].carrying_mul_add(c, a.limbs[i], carry);
        i += 1;
    }

    (a, carry)
}

#[cfg(all(test, feature = "rand_core"))]
mod tests {
    use crate::{Limb, NonZero, Random, RandomMod, Uint};
    use rand_core::SeedableRng;

    #[test]
    fn mul_mod_special() {
        fn test_size<const LIMBS: usize>() {
            let mut rng = chacha20::ChaCha8Rng::seed_from_u64(1);
            let moduli = [
                NonZero::<Limb>::random_from_rng(&mut rng),
                NonZero::<Limb>::random_from_rng(&mut rng),
            ];

            for special in &moduli {
                let p = &NonZero::new(Uint::ZERO.wrapping_sub(&Uint::from(special.get()))).unwrap();

                let minus_one = p.wrapping_sub(&Uint::ONE);

                let base_cases = [
                    (Uint::ZERO, Uint::ZERO, Uint::ZERO),
                    (Uint::ONE, Uint::ZERO, Uint::ZERO),
                    (Uint::ZERO, Uint::ONE, Uint::ZERO),
                    (Uint::ONE, Uint::ONE, Uint::ONE),
                    (minus_one, minus_one, Uint::ONE),
                    (minus_one, Uint::ONE, minus_one),
                    (Uint::ONE, minus_one, minus_one),
                ];
                for (a, b, c) in &base_cases {
                    let x = a.mul_mod_special(b, *special.as_ref());
                    assert_eq!(*c, x, "{} * {} mod {} = {} != {}", a, b, p, x, c);
                }

                let rounds = if cfg!(miri) { 10 } else { 100 };
                for _i in 0..rounds {
                    let a = Uint::<LIMBS>::random_mod_vartime(&mut rng, p);
                    let b = Uint::<LIMBS>::random_mod_vartime(&mut rng, p);

                    let c = a.mul_mod_special(&b, *special.as_ref());
                    assert!(c < **p, "not reduced: {} >= {} ", c, p);

                    let expected = {
                        let prod = a.widening_mul(&b);
                        Uint::rem_wide_vartime(prod, p)
                    };
                    assert_eq!(c, expected, "incorrect result");
                }
            }
        }

        test_size::<1>();
        test_size::<2>();
        test_size::<3>();
        if cfg!(not(miri)) {
            test_size::<4>();
            test_size::<8>();
            test_size::<16>();
        }
    }
}
