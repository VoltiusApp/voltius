//! GCD support for [`Limb`].

use super::Limb;
use crate::{Gcd, NonZero, Odd, Uint};

impl Gcd for Limb {
    type Output = Limb;

    fn gcd(&self, rhs: &Self) -> Self::Output {
        Uint::<1>::from(*self).gcd(&Uint::from(*rhs)).limbs[0]
    }

    fn gcd_vartime(&self, rhs: &Self) -> Self::Output {
        Uint::<1>::from(*self).gcd_vartime(&Uint::from(*rhs)).limbs[0]
    }
}

impl Gcd<Limb> for NonZero<Limb> {
    type Output = Limb;

    fn gcd(&self, rhs: &Limb) -> Self::Output {
        NonZero::<Uint<1>>::from(*self).gcd(&Uint::from(*rhs)).limbs[0]
    }

    fn gcd_vartime(&self, rhs: &Limb) -> Self::Output {
        NonZero::<Uint<1>>::from(*self)
            .gcd_vartime(&Uint::from(*rhs))
            .limbs[0]
    }
}

impl Gcd<Limb> for Odd<Limb> {
    type Output = Limb;

    fn gcd(&self, rhs: &Limb) -> Self::Output {
        Odd::<Uint<1>>::from(*self).gcd(&Uint::from(*rhs)).limbs[0]
    }

    fn gcd_vartime(&self, rhs: &Limb) -> Self::Output {
        Odd::<Uint<1>>::from(*self)
            .gcd_vartime(&Uint::from(*rhs))
            .limbs[0]
    }
}

#[cfg(test)]
mod tests {
    use crate::{Gcd, Limb, Odd};

    #[test]
    fn gcd_expected() {
        let f = Odd::<Limb>::new(Limb::from(61u32 * 71)).expect("ensured odd");
        let g = Limb::from(59u32 * 61);

        assert_eq!(Limb::from(61u32), f.gcd(&g));
        assert_eq!(Limb::from(61u32), f.gcd_vartime(&g));

        let f = f.as_nz_ref();
        assert_eq!(Limb::from(61u32), f.gcd(&g));
        assert_eq!(Limb::from(61u32), f.gcd_vartime(&g));

        let f = f.get();
        assert_eq!(Limb::from(61u32), f.gcd(&g));
        assert_eq!(Limb::from(61u32), f.gcd_vartime(&g));
    }
}
