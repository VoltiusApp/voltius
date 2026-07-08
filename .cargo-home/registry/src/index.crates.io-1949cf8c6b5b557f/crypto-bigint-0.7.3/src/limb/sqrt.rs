//! Square root implementation for [`Limb`].

use super::Limb;
use crate::{CheckedSquareRoot, CtOption, FloorSquareRoot, U64};

impl CheckedSquareRoot for Limb {
    type Output = Self;

    fn checked_sqrt(&self) -> CtOption<Self::Output> {
        U64::from_word(self.0).checked_sqrt().map(|rt| rt.limbs[0])
    }

    fn checked_sqrt_vartime(&self) -> Option<Self::Output> {
        U64::from_word(self.0)
            .checked_sqrt_vartime()
            .map(|rt| rt.limbs[0])
    }
}

impl FloorSquareRoot for Limb {
    fn floor_sqrt(&self) -> Self::Output {
        U64::from_word(self.0).floor_sqrt().limbs[0]
    }

    fn floor_sqrt_vartime(&self) -> Self::Output {
        U64::from_word(self.0).floor_sqrt_vartime().limbs[0]
    }
}
