//! [`BoxedUint`] modular exponentiation operations.

use crate::{
    BoxedUint, Odd,
    modular::{BoxedMontyForm, BoxedMontyParams},
};

impl BoxedUint {
    /// Computes `self ^ rhs mod p` for odd `p`.
    #[must_use]
    pub fn pow_mod(&self, rhs: &BoxedUint, p: &Odd<BoxedUint>) -> BoxedUint {
        BoxedMontyForm::new(self.clone(), &BoxedMontyParams::new(p.clone()))
            .pow(rhs)
            .retrieve()
    }
}

// NOTE: tested via proptests in `tests/boxed_uint.rs`
