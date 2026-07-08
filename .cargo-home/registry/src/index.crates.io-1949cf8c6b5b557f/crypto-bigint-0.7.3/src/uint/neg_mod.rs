//! [`Uint`] modular negation operations.

use crate::{Limb, NegMod, NonZero, Uint};

impl<const LIMBS: usize> Uint<LIMBS> {
    /// Computes `-a mod p`.
    /// Assumes `self` is in `[0, p)`.
    #[must_use]
    pub const fn neg_mod(&self, p: &NonZero<Self>) -> Self {
        let z = self.is_zero();
        let mut ret = p.as_ref().borrowing_sub(self, Limb::ZERO).0;
        ret.as_mut_uint_ref().conditional_set_zero(z);
        ret
    }

    /// Computes `-a mod p` for the special modulus
    /// `p = MAX+1-c` where `c` is small enough to fit in a single [`Limb`].
    #[must_use]
    pub const fn neg_mod_special(&self, c: Limb) -> Self {
        Self::ZERO.sub_mod_special(self, c)
    }
}

impl<const LIMBS: usize> NegMod for Uint<LIMBS> {
    type Output = Self;

    fn neg_mod(&self, p: &NonZero<Self>) -> Self {
        debug_assert!(self < p.as_ref());
        self.neg_mod(p)
    }
}

#[cfg(test)]
mod tests {
    use crate::U256;

    #[test]
    fn neg_mod_random() {
        let x =
            U256::from_be_hex("8d16e171674b4e6d8529edba4593802bf30b8cb161dd30aa8e550d41380007c2");
        let p =
            U256::from_be_hex("928334a4e4be0843ec225a4c9c61df34bdc7a81513e4b6f76f2bfa3148e2e1b5")
                .to_nz()
                .unwrap();

        let actual = x.neg_mod(&p);
        let expected =
            U256::from_be_hex("056c53337d72b9d666f86c9256ce5f08cabc1b63b207864ce0d6ecf010e2d9f3");

        assert_eq!(expected, actual);
    }

    #[test]
    fn neg_mod_zero() {
        let x =
            U256::from_be_hex("0000000000000000000000000000000000000000000000000000000000000000");
        let p =
            U256::from_be_hex("928334a4e4be0843ec225a4c9c61df34bdc7a81513e4b6f76f2bfa3148e2e1b5")
                .to_nz()
                .unwrap();

        let actual = x.neg_mod(&p);
        let expected =
            U256::from_be_hex("0000000000000000000000000000000000000000000000000000000000000000");

        assert_eq!(expected, actual);
    }
}
