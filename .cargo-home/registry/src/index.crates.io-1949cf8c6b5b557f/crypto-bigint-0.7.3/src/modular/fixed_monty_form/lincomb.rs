//! Linear combinations of integers in Montgomery form with a modulus set at runtime.

use super::FixedMontyForm;
use crate::modular::lincomb::lincomb_monty_form;

impl<const LIMBS: usize> FixedMontyForm<LIMBS> {
    /// Calculate the sum of products of pairs `(a, b)` in `products`.
    ///
    /// This method is variable time only with the value of the modulus.
    /// For a modulus with leading zeros, this method is more efficient than a naive sum of products.
    ///
    /// This method will panic if `products` is empty. All terms must be associated
    /// with equivalent `MontyParams`.
    ///
    /// # Panics
    /// - if `products` is empty.
    #[must_use]
    #[track_caller]
    pub const fn lincomb_vartime(products: &[(&Self, &Self)]) -> Self {
        assert!(!products.is_empty(), "empty products");
        let params = &products[0].0.params;
        Self {
            montgomery_form: lincomb_monty_form(
                products,
                &params.modulus,
                params.mod_neg_inv(),
                params.mod_leading_zeros,
            ),
            params: products[0].0.params,
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "rand_core")]
    #[test]
    fn lincomb_expected() {
        use crate::U256;
        use crate::{
            Odd, Random, RandomMod,
            modular::{FixedMontyForm, FixedMontyParams},
        };
        use rand_core::SeedableRng;

        let mut rng = chacha20::ChaCha8Rng::seed_from_u64(1);
        for n in 0..1500 {
            let modulus = Odd::<U256>::random_from_rng(&mut rng);
            let params = FixedMontyParams::new_vartime(modulus);
            let m = modulus.as_nz_ref();
            let a = U256::random_mod_vartime(&mut rng, m);
            let b = U256::random_mod_vartime(&mut rng, m);
            let c = U256::random_mod_vartime(&mut rng, m);
            let d = U256::random_mod_vartime(&mut rng, m);

            assert_eq!(
                a.mul_mod(&b, m).add_mod(&c.mul_mod(&d, m), m),
                FixedMontyForm::lincomb_vartime(&[
                    (
                        &FixedMontyForm::new(&a, &params),
                        &FixedMontyForm::new(&b, &params)
                    ),
                    (
                        &FixedMontyForm::new(&c, &params),
                        &FixedMontyForm::new(&d, &params)
                    ),
                ])
                .retrieve(),
                "n={n}, a={a}, b={b}, c={c}, d={d}"
            );
        }
    }
}
