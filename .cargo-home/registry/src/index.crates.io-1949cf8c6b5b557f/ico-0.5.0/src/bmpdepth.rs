//===========================================================================//

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BmpDepth {
    One,
    Four,
    Eight,
    Sixteen,
    TwentyFour,
    ThirtyTwo,
}

impl BmpDepth {
    pub(crate) fn from_bits_per_pixel(
        bits_per_pixel: u16,
    ) -> Option<BmpDepth> {
        match bits_per_pixel {
            1 => Some(BmpDepth::One),
            4 => Some(BmpDepth::Four),
            8 => Some(BmpDepth::Eight),
            16 => Some(BmpDepth::Sixteen),
            24 => Some(BmpDepth::TwentyFour),
            32 => Some(BmpDepth::ThirtyTwo),
            _ => None,
        }
    }

    pub(crate) fn bits_per_pixel(&self) -> u16 {
        match *self {
            BmpDepth::One => 1,
            BmpDepth::Four => 4,
            BmpDepth::Eight => 8,
            BmpDepth::Sixteen => 16,
            BmpDepth::TwentyFour => 24,
            BmpDepth::ThirtyTwo => 32,
        }
    }

    pub(crate) fn num_colors(&self) -> usize {
        match *self {
            BmpDepth::One => 2,
            BmpDepth::Four => 16,
            BmpDepth::Eight => 256,
            _ => 0,
        }
    }
}

//===========================================================================//

#[cfg(test)]
mod tests {
    use super::BmpDepth;

    #[test]
    fn bmp_depth_round_trip() {
        let depths = &[
            BmpDepth::One,
            BmpDepth::Four,
            BmpDepth::Eight,
            BmpDepth::Sixteen,
            BmpDepth::TwentyFour,
            BmpDepth::ThirtyTwo,
        ];
        for &depth in depths.iter() {
            assert_eq!(
                BmpDepth::from_bits_per_pixel(depth.bits_per_pixel()),
                Some(depth)
            );
        }
    }
}

//===========================================================================//
