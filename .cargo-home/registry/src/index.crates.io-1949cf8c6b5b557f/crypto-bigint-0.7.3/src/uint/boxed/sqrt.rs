//! [`BoxedUint`] square root operations.

use crate::{
    BitOps, BoxedUint, CheckedSquareRoot, CtAssign, CtEq, CtGt, CtOption, FloorSquareRoot, Limb,
};

impl BoxedUint {
    /// Computes `floor(√(self))` in constant time.
    ///
    /// Callers can check if `self` is a square by squaring the result.
    #[deprecated(since = "0.7.0", note = "please use `floor_sqrt` instead")]
    #[must_use]
    pub fn sqrt(&self) -> Self {
        self.floor_sqrt()
    }

    /// Computes √(`self`) in constant time.
    ///
    /// Callers can check if `self` is a square by squaring the result.
    #[must_use]
    pub fn floor_sqrt(&self) -> Self {
        // Uses Brent & Zimmermann, Modern Computer Arithmetic, v0.5.9, Algorithm 1.13.
        //
        // See Hast, "Note on computation of integer square roots"
        // for the proof of the sufficiency of the bound on iterations.
        // https://github.com/RustCrypto/crypto-bigint/files/12600669/ct_sqrt.pdf

        // The initial guess: `x_0 = 2^ceil(b/2)`, where `2^(b-1) <= self < b`.
        // Will not overflow since `b <= BITS`.
        let mut x = Self::one_with_precision(self.bits_precision());
        x.unbounded_shl_assign_vartime((self.bits() + 1) >> 1); // ≥ √(`self`)

        let mut nz_x = x.clone();
        let mut quo = Self::zero_with_precision(self.bits_precision());
        let mut rem = Self::zero_with_precision(self.bits_precision());
        let mut i = 0;

        // Repeat enough times to guarantee result has stabilized.
        // TODO (#378): the tests indicate that just `Self::LOG2_BITS` may be enough.
        while i < self.log2_bits() + 2 {
            let x_nonzero = x.is_nonzero();
            nz_x.ct_assign(&x, x_nonzero);

            // Calculate `x_{i+1} = floor((x_i + self / x_i) / 2)`
            quo.limbs.copy_from_slice(&self.limbs);
            rem.limbs.copy_from_slice(&nz_x.limbs);
            quo.as_mut_uint_ref().div_rem(rem.as_mut_uint_ref());
            x.conditional_carrying_add_assign(&quo, x_nonzero);
            x.shr1_assign();

            i += 1;
        }

        // At this point `x_prev == x_{n}` and `x == x_{n+1}`
        // where `n == i - 1 == LOG2_BITS + 1 == floor(log2(BITS)) + 1`.
        // Thus, according to Hast, `sqrt(self) = min(x_n, x_{n+1})`.
        x.ct_assign(&nz_x, x.ct_gt(&nz_x));
        x
    }

    /// Computes `floor(√(self))`.
    ///
    /// Callers can check if `self` is a square by squaring the result.
    ///
    /// Variable time with respect to `self`.
    #[deprecated(since = "0.7.0", note = "please use `floor_sqrt_vartime` instead")]
    #[must_use]
    pub fn sqrt_vartime(&self) -> Self {
        self.floor_sqrt_vartime()
    }

    /// Computes √(`self`).
    ///
    /// Callers can check if `self` is a square by squaring the result.
    ///
    /// Variable time with respect to `self`.
    #[must_use]
    pub fn floor_sqrt_vartime(&self) -> Self {
        // Uses Brent & Zimmermann, Modern Computer Arithmetic, v0.5.9, Algorithm 1.13

        if self.is_zero_vartime() {
            return Self::zero_with_precision(self.bits_precision());
        }

        // The initial guess: `x_0 = 2^ceil(b/2)`, where `2^(b-1) <= self < b`.
        // Will not overflow since `b <= BITS`.
        // The initial value of `x` is always greater than zero.
        let mut x = Self::one_with_precision(self.bits_precision());
        x.unbounded_shl_assign_vartime((self.bits() + 1) >> 1); // ≥ √(`self`)

        let mut quo = Self::zero_with_precision(self.bits_precision());
        let mut rem = Self::zero_with_precision(self.bits_precision());

        loop {
            // Calculate `x_{i+1} = floor((x_i + self / x_i) / 2)`
            quo.limbs.copy_from_slice(&self.limbs);
            rem.limbs.copy_from_slice(&x.limbs);
            quo.as_mut_uint_ref().div_rem_vartime(rem.as_mut_uint_ref());
            quo.carrying_add_assign(&x, Limb::ZERO);
            quo.shr1_assign();

            // If `quo` is the same as `x` or greater, we reached convergence
            // (`x` is guaranteed to either go down or oscillate between
            // `sqrt(self)` and `sqrt(self) + 1`)
            if !x.cmp_vartime(&quo).is_gt() {
                break;
            }
            x.limbs.copy_from_slice(&quo.limbs);
            if x.is_zero_vartime() {
                break;
            }
        }

        x
    }

    /// Wrapped sqrt is just `floor(√(self))`.
    /// There’s no way wrapping could ever happen.
    /// This function exists so that all operations are accounted for in the wrapping operations.
    #[must_use]
    pub fn wrapping_sqrt(&self) -> Self {
        self.floor_sqrt()
    }

    /// Wrapped sqrt is just `floor(√(self))`.
    /// There’s no way wrapping could ever happen.
    /// This function exists so that all operations are accounted for in the wrapping operations.
    ///
    /// Variable time with respect to `self`.
    #[must_use]
    pub fn wrapping_sqrt_vartime(&self) -> Self {
        self.floor_sqrt_vartime()
    }

    /// Perform checked sqrt, returning a [`CtOption`] which `is_some`
    /// only if the square root is exact.
    #[must_use]
    pub fn checked_sqrt(&self) -> CtOption<Self> {
        let r = self.floor_sqrt();
        let s = r.wrapping_square();
        CtOption::new(r, self.ct_eq(&s))
    }

    /// Perform checked sqrt, returning an [`Option`] which `is_some`
    /// only if the square root is exact.
    ///
    /// Variable time with respect to `self`.
    #[must_use]
    pub fn checked_sqrt_vartime(&self) -> Option<Self> {
        let r = self.floor_sqrt_vartime();
        let s = r.wrapping_square();
        if self.cmp_vartime(&s).is_eq() {
            Some(r)
        } else {
            None
        }
    }
}

impl CheckedSquareRoot for BoxedUint {
    type Output = Self;

    fn checked_sqrt(&self) -> CtOption<Self::Output> {
        self.checked_sqrt()
    }

    fn checked_sqrt_vartime(&self) -> Option<Self::Output> {
        self.checked_sqrt_vartime()
    }
}

impl FloorSquareRoot for BoxedUint {
    fn floor_sqrt(&self) -> Self {
        self.floor_sqrt()
    }

    fn floor_sqrt_vartime(&self) -> Self {
        self.floor_sqrt_vartime()
    }
}

#[cfg(test)]
#[allow(clippy::integer_division_remainder_used, reason = "test")]
mod tests {
    use crate::{BoxedUint, Limb};

    #[cfg(feature = "rand_core")]
    use {
        crate::RandomBits,
        chacha20::ChaCha8Rng,
        rand_core::{Rng, SeedableRng},
    };

    #[test]
    fn edge() {
        assert_eq!(
            BoxedUint::zero_with_precision(256).floor_sqrt(),
            BoxedUint::zero_with_precision(256)
        );
        assert_eq!(
            BoxedUint::one_with_precision(256).floor_sqrt(),
            BoxedUint::one_with_precision(256)
        );
        let mut half = BoxedUint::zero_with_precision(256);
        for i in 0..half.limbs.len() / 2 {
            half.limbs[i] = Limb::MAX;
        }
        let u256_max = !BoxedUint::zero_with_precision(256);
        assert_eq!(u256_max.floor_sqrt(), half);

        // Test edge cases that use up the maximum number of iterations.

        // `x = (r + 1)^2 - 583`, where `r` is the expected square root.
        assert_eq!(
            BoxedUint::from_be_hex("055fa39422bd9f281762946e056535badbf8a6864d45fa3d", 192)
                .unwrap()
                .floor_sqrt(),
            BoxedUint::from_be_hex("0000000000000000000000002516f0832a538b2d98869e21", 192)
                .unwrap(),
        );
        assert_eq!(
            BoxedUint::from_be_hex("055fa39422bd9f281762946e056535badbf8a6864d45fa3d", 192)
                .unwrap()
                .floor_sqrt_vartime(),
            BoxedUint::from_be_hex("0000000000000000000000002516f0832a538b2d98869e21", 192)
                .unwrap()
        );

        // `x = (r + 1)^2 - 205`, where `r` is the expected square root.
        assert_eq!(
            BoxedUint::from_be_hex(
                "4bb750738e25a8f82940737d94a48a91f8cd918a3679ff90c1a631f2bd6c3597",
                256
            )
            .unwrap()
            .floor_sqrt(),
            BoxedUint::from_be_hex(
                "000000000000000000000000000000008b3956339e8315cff66eb6107b610075",
                256
            )
            .unwrap()
        );
        assert_eq!(
            BoxedUint::from_be_hex(
                "4bb750738e25a8f82940737d94a48a91f8cd918a3679ff90c1a631f2bd6c3597",
                256
            )
            .unwrap()
            .floor_sqrt_vartime(),
            BoxedUint::from_be_hex(
                "000000000000000000000000000000008b3956339e8315cff66eb6107b610075",
                256
            )
            .unwrap()
        );
    }

    #[test]
    fn edge_vartime() {
        assert_eq!(
            BoxedUint::zero_with_precision(256).floor_sqrt_vartime(),
            BoxedUint::zero_with_precision(256)
        );
        assert_eq!(
            BoxedUint::one_with_precision(256).floor_sqrt_vartime(),
            BoxedUint::one_with_precision(256)
        );
        let mut half = BoxedUint::zero_with_precision(256);
        for i in 0..half.limbs.len() / 2 {
            half.limbs[i] = Limb::MAX;
        }
        let u256_max = !BoxedUint::zero_with_precision(256);
        assert_eq!(u256_max.floor_sqrt_vartime(), half);
    }

    #[test]
    fn simple() {
        let tests = [
            (4u8, 2u8),
            (9, 3),
            (16, 4),
            (25, 5),
            (36, 6),
            (49, 7),
            (64, 8),
            (81, 9),
            (100, 10),
            (121, 11),
            (144, 12),
            (169, 13),
        ];
        for (a, e) in &tests {
            let l = BoxedUint::from(*a);
            let r = BoxedUint::from(*e);
            assert_eq!(l.floor_sqrt(), r);
            assert_eq!(l.floor_sqrt_vartime(), r);
            assert!(l.checked_sqrt().is_some().to_bool());
            assert!(l.checked_sqrt_vartime().is_some());
        }
    }

    #[test]
    fn nonsquares() {
        assert_eq!(BoxedUint::from(2u8).floor_sqrt(), BoxedUint::from(1u8));
        assert!(!BoxedUint::from(2u8).checked_sqrt().is_some().to_bool());
        assert_eq!(BoxedUint::from(3u8).floor_sqrt(), BoxedUint::from(1u8));
        assert!(!BoxedUint::from(3u8).checked_sqrt().is_some().to_bool());
        assert_eq!(BoxedUint::from(5u8).floor_sqrt(), BoxedUint::from(2u8));
        assert_eq!(BoxedUint::from(6u8).floor_sqrt(), BoxedUint::from(2u8));
        assert_eq!(BoxedUint::from(7u8).floor_sqrt(), BoxedUint::from(2u8));
        assert_eq!(BoxedUint::from(8u8).floor_sqrt(), BoxedUint::from(2u8));
        assert_eq!(BoxedUint::from(10u8).floor_sqrt(), BoxedUint::from(3u8));
    }

    #[test]
    fn nonsquares_vartime() {
        assert_eq!(
            BoxedUint::from(2u8).floor_sqrt_vartime(),
            BoxedUint::from(1u8)
        );
        assert!(BoxedUint::from(2u8).checked_sqrt_vartime().is_none());
        assert_eq!(
            BoxedUint::from(3u8).floor_sqrt_vartime(),
            BoxedUint::from(1u8)
        );
        assert!(BoxedUint::from(3u8).checked_sqrt_vartime().is_none());
        assert_eq!(
            BoxedUint::from(5u8).floor_sqrt_vartime(),
            BoxedUint::from(2u8)
        );
        assert_eq!(
            BoxedUint::from(6u8).floor_sqrt_vartime(),
            BoxedUint::from(2u8)
        );
        assert_eq!(
            BoxedUint::from(7u8).floor_sqrt_vartime(),
            BoxedUint::from(2u8)
        );
        assert_eq!(
            BoxedUint::from(8u8).floor_sqrt_vartime(),
            BoxedUint::from(2u8)
        );
        assert_eq!(
            BoxedUint::from(10u8).floor_sqrt_vartime(),
            BoxedUint::from(3u8)
        );
    }

    #[cfg(feature = "rand_core")]
    #[test]
    fn fuzz() {
        use crate::{CheckedSquareRoot, ConcatenatingSquare};

        let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
        let rounds = if cfg!(miri) { 10 } else { 50 };
        for _ in 0..rounds {
            let t = u64::from(rng.next_u32());
            let s = BoxedUint::from(t);
            let s2 = s.checked_mul(&s).unwrap();
            assert_eq!(s2.floor_sqrt(), s);
            assert_eq!(s2.floor_sqrt_vartime(), s);
            assert!(CheckedSquareRoot::checked_sqrt(&s2).is_some().to_bool());
            assert!(CheckedSquareRoot::checked_sqrt_vartime(&s2).is_some());
        }

        for _ in 0..rounds {
            let s = BoxedUint::random_bits(&mut rng, 512);
            let mut s2 = BoxedUint::zero_with_precision(512);
            s2.limbs[..s.limbs.len()].copy_from_slice(&s.limbs);
            assert_eq!(s.concatenating_square().floor_sqrt(), s2);
            assert_eq!(s.concatenating_square().floor_sqrt_vartime(), s2);
        }
    }
}
