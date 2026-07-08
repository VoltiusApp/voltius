use crate::{ArrayLength, GenericArray};

use zeroize::{Zeroize, ZeroizeOnDrop};

impl<Z: Zeroize, N: ArrayLength> Zeroize for GenericArray<Z, N> {
    fn zeroize(&mut self) {
        self.as_mut_slice().iter_mut().zeroize()
    }
}

impl<Z: ZeroizeOnDrop, N: ArrayLength> ZeroizeOnDrop for GenericArray<Z, N> {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zeroize() {
        let mut array = GenericArray::<u8, typenum::U2>::default();
        array[0] = 4;
        array[1] = 9;
        array.zeroize();
        assert_eq!(array[0], 0);
        assert_eq!(array[1], 0);
    }
}
