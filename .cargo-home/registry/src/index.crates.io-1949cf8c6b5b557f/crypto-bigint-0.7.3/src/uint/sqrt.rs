//! [`Uint`] square root operations.

use crate::{CheckedSquareRoot, CtEq, CtOption, FloorSquareRoot, Limb, NonZero, Uint};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Computes `floor(√(self))` in constant time.
    ///
    /// Callers can check if `self` is a square by squaring the result.
    #[deprecated(since = "0.7.0", note = "please use `floor_sqrt` instead")]
    #[must_use]
    pub const fn sqrt(&self) -> Self {
        self.floor_sqrt()
    }

    /// Computes `floor(√(self))` in constant time.
    ///
    /// Callers can check if `self` is a square by squaring the result.
    #[must_use]
    pub const fn floor_sqrt(&self) -> Self {
        let self_is_nz = self.is_nonzero();
        let root_nz = NonZero(Self::select(&Self::ONE, self, self_is_nz))
            .floor_sqrt()
            .get_copy();
        Self::select(&Self::ZERO, &root_nz, self_is_nz)
    }

    /// Computes `floor(√(self))`.
    ///
    /// Callers can check if `self` is a square by squaring the result.
    ///
    /// Variable time with respect to `self`.
    #[deprecated(since = "0.7.0", note = "please use `floor_sqrt_vartime` instead")]
    #[must_use]
    pub const fn sqrt_vartime(&self) -> Self {
        self.floor_sqrt_vartime()
    }

    /// Computes `floor(√(self))`.
    ///
    /// Callers can check if `self` is a square by squaring the result.
    ///
    /// Variable time with respect to `self`.
    #[must_use]
    pub const fn floor_sqrt_vartime(&self) -> Self {
        if self.is_zero_vartime() {
            Self::ZERO
        } else {
            NonZero(*self).floor_sqrt_vartime().get_copy()
        }
    }

    /// Wrapped sqrt is just `floor(√(self))`.
    /// There’s no way wrapping could ever happen.
    /// This function exists so that all operations are accounted for in the wrapping operations.
    #[must_use]
    pub const fn wrapping_sqrt(&self) -> Self {
        self.floor_sqrt()
    }

    /// Wrapped sqrt is just `floor(√(self))`.
    /// There’s no way wrapping could ever happen.
    /// This function exists so that all operations are accounted for in the wrapping operations.
    ///
    /// Variable time with respect to `self`.
    #[must_use]
    pub const fn wrapping_sqrt_vartime(&self) -> Self {
        self.floor_sqrt_vartime()
    }

    /// Perform checked sqrt, returning a [`CtOption`] which `is_some`
    /// only if the square root is exact.
    #[must_use]
    pub fn checked_sqrt(&self) -> CtOption<Self> {
        let self_is_nz = self.is_nonzero();
        NonZero(Self::select(&Self::ONE, self, self_is_nz))
            .checked_sqrt()
            .map(|nz| Self::select(&Self::ZERO, nz.as_ref(), self_is_nz))
    }

    /// Perform checked sqrt, returning an [`Option`] which `is_some`
    /// only if the square root is exact.
    ///
    /// Variable time with respect to `self`.
    pub fn checked_sqrt_vartime(&self) -> Option<Self> {
        if self.is_zero_vartime() {
            Some(Self::ZERO)
        } else {
            NonZero(*self).checked_sqrt_vartime().map(NonZero::get)
        }
    }
}

impl<const LIMBS: usize> NonZero<Uint<LIMBS>> {
    /// Computes `floor(√(self))` in constant time.
    ///
    /// Callers can check if `self` is a square by squaring the result.
    #[must_use]
    pub const fn floor_sqrt(&self) -> Self {
        // Uses Brent & Zimmermann, Modern Computer Arithmetic, v0.5.9, Algorithm 1.13.
        //
        // See Hast, "Note on computation of integer square roots"
        // for the proof of the sufficiency of the bound on iterations.
        // https://github.com/RustCrypto/crypto-bigint/files/12600669/ct_sqrt.pdf

        let rt_bits = self.0.bits().div_ceil(2);
        // The initial guess: `x_0 = 2^ceil(b/2)`, where `2^(b-1) <= self < 2^b`.
        // Will not overflow since `b <= BITS`.
        let mut x = Uint::<LIMBS>::ZERO.set_bit_vartime(rt_bits, true);
        // Compute `self.0 / x_0` by shifting.
        let mut q = self.0.shr(rt_bits);
        // The first division has been performed.
        let mut i = 1;

        loop {
            // Calculate `x_{i+1} = floor((x_i + self_nz / x_i) / 2)`, leaving `x` unmodified
            // if it would increase.
            x = Uint::select(&x.wrapping_add(&q).shr1(), &x, Uint::lt(&x, &q));

            // We repeat enough times to guarantee the result has stabilized.
            // TODO (#378): the tests indicate that just `Self::LOG2_BITS` may be enough.
            i += 1;
            if i >= Uint::<LIMBS>::LOG2_BITS + 2 {
                return x.to_nz().expect_copied("ensured non-zero");
            }

            (q, _) = self.0.div_rem(x.to_nz().expect_ref("ensured non-zero"));
        }
    }

    /// Computes `floor(√(self))`.
    ///
    /// Callers can check if `self` is a square by squaring the result.
    ///
    /// Variable time with respect to `self`.
    #[must_use]
    pub const fn floor_sqrt_vartime(&self) -> Self {
        // Uses Brent & Zimmermann, Modern Computer Arithmetic, v0.5.9, Algorithm 1.13

        let bits = self.0.bits_vartime();
        if bits <= Limb::BITS {
            let rt = self.0.limbs[0].0.isqrt();
            return Uint::from_word(rt)
                .to_nz()
                .expect_copied("ensured non-zero");
        }
        let rt_bits = bits.div_ceil(2);

        // The initial guess: `x_0 = 2^ceil(b/2)`, where `2^(b-1) <= self < b`.
        // Will not overflow since `b <= BITS`.
        let mut x = Uint::ZERO.set_bit_vartime(rt_bits, true);
        // Compute `self / x_0` by shifting.
        let mut q = self.0.shr_vartime(rt_bits);

        loop {
            // Terminate if `x_{i+1}` >= `x`.
            if q.cmp_vartime(&x).is_ge() {
                return x.to_nz().expect_copied("ensured non-zero");
            }
            // Calculate `x_{i+1} = floor((x_i + self / x_i) / 2)`
            x = x.wrapping_add(&q).shr_vartime(1);
            q = self
                .0
                .wrapping_div_vartime(x.to_nz().expect_ref("ensured non-zero"));
        }
    }

    /// Perform checked sqrt, returning a [`CtOption`] which `is_some`
    /// only if the square root is exact.
    #[must_use]
    pub fn checked_sqrt(&self) -> CtOption<Self> {
        let r = self.floor_sqrt();
        let s = r.wrapping_square();
        CtOption::new(r, self.0.ct_eq(&s))
    }

    /// Perform checked sqrt, returning an [`Option`] which `is_some`
    /// only if the square root is exact.
    #[must_use]
    pub fn checked_sqrt_vartime(&self) -> Option<Self> {
        let r = self.floor_sqrt_vartime();
        let s = r.wrapping_square();
        if self.0.cmp_vartime(&s).is_eq() {
            Some(r)
        } else {
            None
        }
    }
}

impl<const LIMBS: usize> CheckedSquareRoot for Uint<LIMBS> {
    type Output = Self;

    fn checked_sqrt(&self) -> CtOption<Self> {
        self.checked_sqrt()
    }

    fn checked_sqrt_vartime(&self) -> Option<Self> {
        self.checked_sqrt_vartime()
    }
}

impl<const LIMBS: usize> FloorSquareRoot for Uint<LIMBS> {
    fn floor_sqrt(&self) -> Self {
        self.floor_sqrt()
    }

    fn floor_sqrt_vartime(&self) -> Self {
        self.floor_sqrt_vartime()
    }
}

impl<const LIMBS: usize> CheckedSquareRoot for NonZero<Uint<LIMBS>> {
    type Output = Self;

    fn checked_sqrt(&self) -> CtOption<Self> {
        self.checked_sqrt()
    }

    fn checked_sqrt_vartime(&self) -> Option<Self> {
        self.checked_sqrt_vartime()
    }
}

impl<const LIMBS: usize> FloorSquareRoot for NonZero<Uint<LIMBS>> {
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
    use crate::{Limb, U192, U256};

    #[cfg(feature = "rand_core")]
    use {
        crate::{Random, U512},
        chacha20::ChaCha8Rng,
        rand_core::{Rng, SeedableRng},
    };

    #[test]
    fn edge() {
        assert_eq!(U256::ZERO.floor_sqrt(), U256::ZERO);
        assert_eq!(U256::ONE.floor_sqrt(), U256::ONE);
        let mut half = U256::ZERO;
        for i in 0..half.limbs.len() / 2 {
            half.limbs[i] = Limb::MAX;
        }
        assert_eq!(U256::MAX.floor_sqrt(), half);

        // Test edge cases that use up the maximum number of iterations.

        // `x = (r + 1)^2 - 583`, where `r` is the expected square root.
        assert_eq!(
            U192::from_be_hex("055fa39422bd9f281762946e056535badbf8a6864d45fa3d").floor_sqrt(),
            U192::from_be_hex("0000000000000000000000002516f0832a538b2d98869e21")
        );
        assert_eq!(
            U192::from_be_hex("055fa39422bd9f281762946e056535badbf8a6864d45fa3d")
                .floor_sqrt_vartime(),
            U192::from_be_hex("0000000000000000000000002516f0832a538b2d98869e21")
        );

        // `x = (r + 1)^2 - 205`, where `r` is the expected square root.
        assert_eq!(
            U256::from_be_hex("4bb750738e25a8f82940737d94a48a91f8cd918a3679ff90c1a631f2bd6c3597")
                .floor_sqrt(),
            U256::from_be_hex("000000000000000000000000000000008b3956339e8315cff66eb6107b610075")
        );
        assert_eq!(
            U256::from_be_hex("4bb750738e25a8f82940737d94a48a91f8cd918a3679ff90c1a631f2bd6c3597")
                .floor_sqrt_vartime(),
            U256::from_be_hex("000000000000000000000000000000008b3956339e8315cff66eb6107b610075")
        );
    }

    #[test]
    fn edge_vartime() {
        assert_eq!(U256::ZERO.floor_sqrt_vartime(), U256::ZERO);
        assert_eq!(U256::ONE.floor_sqrt_vartime(), U256::ONE);
        let mut half = U256::ZERO;
        for i in 0..half.limbs.len() / 2 {
            half.limbs[i] = Limb::MAX;
        }
        assert_eq!(U256::MAX.floor_sqrt_vartime(), half);
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
            let l = U256::from(*a);
            let r = U256::from(*e);
            assert_eq!(l.floor_sqrt(), r);
            assert_eq!(l.floor_sqrt_vartime(), r);
            assert!(l.checked_sqrt().is_some().to_bool());
            assert!(l.checked_sqrt_vartime().is_some());
        }
    }

    #[test]
    fn nonsquares() {
        assert_eq!(U256::from(2u8).floor_sqrt(), U256::from(1u8));
        assert!(!U256::from(2u8).checked_sqrt().is_some().to_bool());
        assert_eq!(U256::from(3u8).floor_sqrt(), U256::from(1u8));
        assert!(!U256::from(3u8).checked_sqrt().is_some().to_bool());
        assert_eq!(U256::from(5u8).floor_sqrt(), U256::from(2u8));
        assert_eq!(U256::from(6u8).floor_sqrt(), U256::from(2u8));
        assert_eq!(U256::from(7u8).floor_sqrt(), U256::from(2u8));
        assert_eq!(U256::from(8u8).floor_sqrt(), U256::from(2u8));
        assert_eq!(U256::from(10u8).floor_sqrt(), U256::from(3u8));
    }

    #[test]
    fn nonsquares_vartime() {
        assert_eq!(U256::from(2u8).floor_sqrt_vartime(), U256::from(1u8));
        assert!(U256::from(2u8).checked_sqrt_vartime().is_none());
        assert_eq!(U256::from(3u8).floor_sqrt_vartime(), U256::from(1u8));
        assert!(U256::from(3u8).checked_sqrt_vartime().is_none());
        assert_eq!(U256::from(5u8).floor_sqrt_vartime(), U256::from(2u8));
        assert_eq!(U256::from(6u8).floor_sqrt_vartime(), U256::from(2u8));
        assert_eq!(U256::from(7u8).floor_sqrt_vartime(), U256::from(2u8));
        assert_eq!(U256::from(8u8).floor_sqrt_vartime(), U256::from(2u8));
        assert_eq!(U256::from(10u8).floor_sqrt_vartime(), U256::from(3u8));
    }

    #[cfg(feature = "rand_core")]
    #[test]
    fn fuzz() {
        use crate::{CheckedSquareRoot, FloorSquareRoot};

        let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
        for _ in 0..50 {
            let t = u64::from(rng.next_u32());
            let s = U256::from(t);
            let s2 = s.checked_square().unwrap();
            assert_eq!(FloorSquareRoot::floor_sqrt(&s2), s);
            assert_eq!(FloorSquareRoot::floor_sqrt_vartime(&s2), s);
            assert!(CheckedSquareRoot::checked_sqrt(&s2).is_some().to_bool());
            assert!(CheckedSquareRoot::checked_sqrt_vartime(&s2).is_some());

            if let Some(nz) = s2.to_nz().into_option() {
                assert_eq!(FloorSquareRoot::floor_sqrt(&nz).get(), s);
                assert_eq!(FloorSquareRoot::floor_sqrt_vartime(&nz).get(), s);
                assert!(CheckedSquareRoot::checked_sqrt(&nz).is_some().to_bool());
                assert!(CheckedSquareRoot::checked_sqrt_vartime(&nz).is_some());
            }
        }

        for _ in 0..50 {
            let s = U256::random_from_rng(&mut rng);
            let mut s2 = U512::ZERO;
            s2.limbs[..s.limbs.len()].copy_from_slice(&s.limbs);
            assert_eq!(s.concatenating_square().floor_sqrt(), s2);
            assert_eq!(s.concatenating_square().floor_sqrt_vartime(), s2);
        }
    }
}
