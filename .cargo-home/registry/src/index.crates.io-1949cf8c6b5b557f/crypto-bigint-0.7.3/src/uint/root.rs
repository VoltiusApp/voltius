//! Support for nth root calculation for [`Uint`].

use core::num::NonZeroU32;

use crate::{Limb, NonZero, Reciprocal, U64, Uint};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Computes `floor(self^(1/exp))`.
    ///
    /// Callers can check if `self` is an exact power of `exp` by exponentiating the result.
    ///
    /// This method is variable time in `self` and in the exponent.
    #[must_use]
    pub const fn floor_root_vartime(&self, exp: NonZeroU32) -> Self {
        if self.is_zero_vartime() {
            Self::ZERO
        } else {
            NonZero(*self).floor_root_vartime(exp).get_copy()
        }
    }

    /// Compute the root `self^(1/exp)` returning an [`Option`] which `is_some`
    /// only if the root is exact.
    ///
    /// This method is variable time in `self` and in the exponent.
    pub fn checked_root_vartime(&self, exp: NonZeroU32) -> Option<Self> {
        if self.is_zero_vartime() {
            Some(Self::ZERO)
        } else {
            NonZero(*self).checked_root_vartime(exp).map(NonZero::get)
        }
    }
}

impl<const LIMBS: usize> NonZero<Uint<LIMBS>> {
    /// Computes `floor(self^(1/exp))`.
    ///
    /// Callers can check if `self` is an exact power of `exp` by exponentiating the result.
    ///
    /// This method is variable time in self and in the exponent.
    #[must_use]
    pub const fn floor_root_vartime(&self, exp: NonZeroU32) -> Self {
        // Uses Brent & Zimmermann, Modern Computer Arithmetic, v0.5.9, Algorithm 1.14.

        if exp.get() == 1 {
            return *self;
        }
        let exp_m1 = exp.get() - 1;
        let exp_m1_limb = Limb::from_u32(exp_m1);
        let exp_recip = Reciprocal::new(NonZero::<Limb>::from_u32(exp));

        let rt_bits = self.0.bits().div_ceil(exp.get());
        // The initial guess: `x_0 = 2^ceil(b/exp)`, where `exp^(b-1) <= self < exp^b`.
        // Will not overflow since `b <= BITS`.
        let mut x = Uint::<LIMBS>::ZERO.set_bit_vartime(rt_bits, true);
        // Compute `self.0 / x_0^(exp-1)` by shifting.
        let mut q = self.0.shr(rt_bits * exp_m1);

        loop {
            // Calculate `x_{i+1} = floor((x_i*(exp-1) + self / x_i^(1/(exp-1))) / exp)`, leaving `x` unmodified
            // if it would increase.
            let x2 = x
                .wrapping_mul_limb(exp_m1_limb)
                .wrapping_add(&q)
                .div_rem_limb_with_reciprocal(&exp_recip)
                .0;

            // Terminate if `x_{i+1}` >= `x`.
            if x2.cmp_vartime(&x).is_ge() {
                return x.to_nz().expect_copied("ensured non-zero");
            }
            x = x2;

            (q, _) = self.0.div_rem_vartime(
                x.wrapping_pow_vartime(&U64::from_u32(exp_m1))
                    .to_nz()
                    .expect_ref("ensured non-zero"),
            );
        }
    }

    /// Compute the root `self^(1/exp)` returning an [`Option`] which `is_some`
    /// only if the root is exact.
    ///
    /// This method is variable time in `self` and in the exponent.
    #[must_use]
    pub fn checked_root_vartime(&self, exp: NonZeroU32) -> Option<Self> {
        let r = self.floor_root_vartime(exp);
        let s = r.wrapping_pow_vartime(&U64::from_u32(exp.get()));
        if self.cmp_vartime(&s).is_eq() {
            Some(r)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::U256;
    use core::num::NonZeroU32;

    #[cfg(feature = "rand_core")]
    use {
        crate::{Limb, Random},
        chacha20::ChaCha8Rng,
        rand_core::SeedableRng,
    };

    #[test]
    fn floor_root_vartime_expected() {
        let three = NonZeroU32::new(3).unwrap();
        assert_eq!(U256::from(0u8).floor_root_vartime(three), U256::from(0u8));
        assert!(U256::from(0u8).checked_root_vartime(three).is_some());
        assert_eq!(U256::from(1u8).floor_root_vartime(three), U256::from(1u8));
        assert!(U256::from(1u8).checked_root_vartime(three).is_some());
        assert_eq!(U256::from(2u8).floor_root_vartime(three), U256::from(1u8));
        assert!(U256::from(2u8).checked_root_vartime(three).is_none());
        assert_eq!(U256::from(8u8).floor_root_vartime(three), U256::from(2u8));
        assert!(U256::from(8u8).checked_root_vartime(three).is_some());
        assert_eq!(U256::from(9u8).floor_root_vartime(three), U256::from(2u8));
        assert!(U256::from(9u8).checked_root_vartime(three).is_none());
    }

    #[cfg(feature = "rand_core")]
    #[test]
    fn fuzz() {
        use crate::U64;
        use core::num::NonZeroU32;

        let mut rng: ChaCha8Rng = ChaCha8Rng::from_seed([7u8; 32]);

        for _ in 0..50 {
            let s = U256::random_from_rng(&mut rng);
            let Some(s) = s.to_nz().into_option() else {
                continue;
            };
            for exp in 1..10 {
                let exp = NonZeroU32::new(exp).unwrap();
                let exp_uint = U64::from_u32(exp.get());
                let root = s.floor_root_vartime(exp);

                // root is correct if rt^exp <= s and (rt+1)^exp > s
                let s2 = root
                    .checked_pow_vartime(&exp_uint)
                    .expect("overflow, {s} exp={exp}, root={rt}");
                assert!(s2 <= s.get(), "overflow, {s} exp={exp}, root={root}");
                let rt_p1 = root.wrapping_add_limb(Limb::ONE);
                let s3 = rt_p1.checked_pow_vartime(&exp_uint).into_option();
                assert!(
                    s3.is_none_or(|s3| s3 > s2),
                    "underflow, {s} exp={exp}, root={root}"
                );
            }
        }
    }
}
