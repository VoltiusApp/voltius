//! Support for computing modular symbols.

use crate::{JacobiSymbol, Odd, U64, U128, Uint};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Compute the Jacobi symbol `(self|rhs)`.
    ///
    /// For prime `rhs`, this corresponds to the Legendre symbol and
    /// indicates whether `self` is quadratic residue modulo `rhs`.
    #[must_use]
    #[allow(clippy::cast_possible_truncation)]
    pub const fn jacobi_symbol<const RHS_LIMBS: usize>(
        &self,
        rhs: &Odd<Uint<RHS_LIMBS>>,
    ) -> JacobiSymbol {
        if LIMBS > RHS_LIMBS {
            // Ensure `a` is reduced modulo `b` and operate on the smallest limb size
            let a = self.rem(rhs.as_nz_ref());
            return a.jacobi_symbol(rhs);
        }

        let (gcd, jacobi_neg) = if LIMBS < 4 {
            rhs.classic_bingcd_(&self.resize())
        } else {
            rhs.optimized_bingcd_::<{ U64::BITS }, { U64::LIMBS }, { U128::LIMBS }>(
                &self.resize(),
                U64::BITS - 2,
            )
        };
        // The sign of the Jacobi symbol is represented by jacobi_neg. We select 0 as the
        // symbol when the GCD is not one, otherwise 1 or -1.
        let jacobi = (jacobi_neg as i8 * -2 + 1) as i64;
        JacobiSymbol::from_i8(Uint::eq(gcd.as_ref(), &Uint::ONE).select_i64(0, jacobi) as i8)
    }

    /// Compute the Jacobi symbol `(self|rhs)`.
    ///
    /// For prime `rhs`, this corresponds to the Legendre symbol and
    /// indicates whether `self` is quadratic residue modulo `rhs`.
    ///
    /// This method executes in variable-time for both inputs.
    #[must_use]
    #[allow(clippy::cast_possible_truncation)]
    pub const fn jacobi_symbol_vartime<const RHS_LIMBS: usize>(
        &self,
        rhs: &Odd<Uint<RHS_LIMBS>>,
    ) -> JacobiSymbol {
        if LIMBS > RHS_LIMBS {
            // Ensure `a` is reduced modulo `b` and operate on the smallest limb size
            let a = self.rem_vartime(rhs.as_nz_ref());
            return a.jacobi_symbol_vartime(rhs);
        } else if RHS_LIMBS > LIMBS {
            if self.is_zero_vartime() {
                return if rhs.as_ref().cmp_vartime(&Uint::ONE).is_eq() {
                    JacobiSymbol::One
                } else {
                    JacobiSymbol::Zero
                };
            } else {
                // Perform an initial swap and reduction and operate on the smallest limb size
                let mut jacobi_neg = 0;

                let tail = self.trailing_zeros_vartime();
                if tail & 1 == 1 {
                    // (2a|b) = -(a|b) iff b = ±3 mod 8
                    // b is always odd, so we ignore the lower bit and check that bits 2 and 3 are '01' or '10'
                    let b_lo = rhs.as_ref().limbs[0].0;
                    jacobi_neg ^= ((b_lo >> 1) ^ (b_lo >> 2)) & 1;
                }

                // (b|a) = -(a|b) iff a = b = 3 mod 4 (quadratic reciprocity)
                let b = self
                    .shr_vartime(tail)
                    .to_odd()
                    .expect_copied("ensured non-zero");
                let a_b_mod_4 = b.as_ref().limbs[0].0 & rhs.as_ref().limbs[0].0 & 3;
                jacobi_neg ^= a_b_mod_4 & (a_b_mod_4 >> 1) & 1;

                // (a, b) = (b % a, a)
                let a = rhs.as_ref().rem_vartime(b.as_nz_ref());
                let jacobi_symbol = a.jacobi_symbol_vartime(&b);
                return if jacobi_neg == 1 {
                    jacobi_symbol.neg()
                } else {
                    jacobi_symbol
                };
            }
        }

        let (gcd, jacobi_neg) = if LIMBS < 4 {
            rhs.classic_bingcd_vartime_(&self.resize())
        } else {
            rhs.optimized_bingcd_vartime_::<{ U64::BITS }, { U64::LIMBS }, { U128::LIMBS }>(
                &self.resize(),
                U64::BITS - 2,
            )
        };
        JacobiSymbol::from_i8(if gcd.as_ref().cmp_vartime(&Uint::ONE).is_eq() {
            jacobi_neg as i8 * -2 + 1
        } else {
            0
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::{JacobiSymbol, U256};

    #[test]
    fn jacobi_quad_residue() {
        // Two semiprimes with no common factors, and
        // f is quadratic residue modulo g
        let f = U256::from(59u32 * 67);
        let g = U256::from(61u32 * 71).to_odd().unwrap();
        let res = f.jacobi_symbol(&g);
        let res_small = f.resize::<1>().jacobi_symbol(&g);
        let res_large = f.jacobi_symbol(&g.resize::<1>());
        let res_vartime = f.jacobi_symbol_vartime(&g);
        let res_vartime_small = f.resize::<1>().jacobi_symbol_vartime(&g);
        let res_vartime_large = f.jacobi_symbol_vartime(&g.resize::<1>());
        assert_eq!(res, JacobiSymbol::One);
        assert_eq!(res, res_small);
        assert_eq!(res, res_large);
        assert_eq!(res, res_vartime);
        assert_eq!(res, res_vartime_small);
        assert_eq!(res, res_vartime_large);
    }

    #[test]
    fn jacobi_non_quad_residue() {
        // f and g have no common factors, but
        // f is not quadratic residue modulo g
        let f = U256::from(59u32 * 67 + 2);
        let g = U256::from(61u32 * 71).to_odd().unwrap();
        let res = f.jacobi_symbol(&g);
        let res_small = f.resize::<1>().jacobi_symbol(&g);
        let res_large = f.jacobi_symbol(&g.resize::<1>());
        let res_vartime = f.jacobi_symbol_vartime(&g);
        let res_vartime_small = f.resize::<1>().jacobi_symbol_vartime(&g);
        let res_vartime_large = f.jacobi_symbol_vartime(&g.resize::<1>());
        assert_eq!(res, JacobiSymbol::MinusOne);
        assert_eq!(res, res_small);
        assert_eq!(res, res_large);
        assert_eq!(res, res_vartime);
        assert_eq!(res, res_vartime_small);
        assert_eq!(res, res_vartime_large);
    }

    #[test]
    fn jacobi_non_coprime() {
        let f = U256::from(4391633u32);
        let g = U256::from(2022161u32).to_odd().unwrap();
        let res = f.jacobi_symbol(&g);
        let res_small = f.resize::<1>().jacobi_symbol(&g);
        let res_large = f.jacobi_symbol(&g.resize::<1>());
        let res_vartime = f.jacobi_symbol_vartime(&g);
        let res_vartime_small = f.resize::<1>().jacobi_symbol_vartime(&g);
        let res_vartime_large = f.jacobi_symbol_vartime(&g.resize::<1>());
        assert_eq!(res, JacobiSymbol::Zero);
        assert_eq!(res, res_small);
        assert_eq!(res, res_large);
        assert_eq!(res, res_vartime);
        assert_eq!(res, res_vartime_small);
        assert_eq!(res, res_vartime_large);
    }

    #[test]
    fn jacobi_zero() {
        let f = U256::ZERO;
        let g = U256::ONE.to_odd().unwrap();
        let res = f.jacobi_symbol(&g);
        let res_small = f.resize::<1>().jacobi_symbol(&g);
        let res_large = f.jacobi_symbol(&g.resize::<1>());
        let res_vartime = f.jacobi_symbol_vartime(&g);
        let res_vartime_small = f.resize::<1>().jacobi_symbol_vartime(&g);
        let res_vartime_large = f.jacobi_symbol_vartime(&g.resize::<1>());
        assert_eq!(res, JacobiSymbol::One);
        assert_eq!(res, res_small);
        assert_eq!(res, res_large);
        assert_eq!(res, res_vartime);
        assert_eq!(res, res_vartime_small);
        assert_eq!(res, res_vartime_large);
    }

    #[test]
    fn jacobi_one() {
        let f = U256::ONE;
        let g = U256::ONE.to_odd().unwrap();
        let res = f.jacobi_symbol(&g);
        let res_small = f.resize::<1>().jacobi_symbol(&g);
        let res_large = f.jacobi_symbol(&g.resize::<1>());
        let res_vartime = f.jacobi_symbol_vartime(&g);
        let res_vartime_small = f.resize::<1>().jacobi_symbol_vartime(&g);
        let res_vartime_large = f.jacobi_symbol_vartime(&g.resize::<1>());
        assert_eq!(res, JacobiSymbol::One);
        assert_eq!(res, res_small);
        assert_eq!(res, res_large);
        assert_eq!(res, res_vartime);
        assert_eq!(res, res_vartime_small);
        assert_eq!(res, res_vartime_large);
    }
}
