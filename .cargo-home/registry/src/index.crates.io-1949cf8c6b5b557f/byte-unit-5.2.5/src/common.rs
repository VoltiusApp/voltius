use core::str::Bytes;

#[cfg(any(feature = "byte", feature = "bit"))]
use rust_decimal::prelude::*;

/// # Safety
/// Make sure the input is valid on your own.
pub(crate) unsafe fn get_char_from_bytes(e: u8, mut bytes: Bytes) -> char {
    let width = unsafe { utf8_width::get_width_assume_valid(e) };

    let mut char_bytes = [0; 4];

    char_bytes[0] = e;

    if width > 1 {
        for e in char_bytes[1..].iter_mut().take(width - 1) {
            *e = bytes.next().unwrap();
        }
    }

    let s = unsafe { core::str::from_utf8_unchecked(&char_bytes[..width]) };

    unsafe { s.chars().next().unwrap_unchecked() }
}

#[cfg(any(feature = "byte", feature = "bit"))]
#[cfg(feature = "std")]
#[inline]
pub(crate) fn ceil_f64(v: f64) -> f64 {
    v.ceil()
}

#[cfg(any(feature = "byte", feature = "bit"))]
#[cfg(not(feature = "std"))]
#[inline]
pub(crate) fn ceil_f64(v: f64) -> f64 {
    debug_assert!(v >= 0.0);

    Decimal::from_f64(v).unwrap().ceil().to_f64().unwrap()
}

#[cfg(any(feature = "byte", feature = "bit"))]
#[cfg(feature = "std")]
#[inline]
pub(crate) fn ceil_f32(v: f32) -> f32 {
    debug_assert!(v >= 0.0);

    v.ceil()
}

#[cfg(any(feature = "byte", feature = "bit"))]
#[cfg(not(feature = "std"))]
#[inline]
pub(crate) fn ceil_f32(v: f32) -> f32 {
    debug_assert!(v >= 0.0);

    Decimal::from_f32(v).unwrap().ceil().to_f32().unwrap()
}

#[cfg(any(feature = "byte", feature = "bit"))]
#[cfg(feature = "std")]
#[inline]
pub fn round_fractional_part_f64(value: f64, mut precision: usize) -> f64 {
    if precision > 16 {
        precision = 16;
    } else if precision == 0 {
        return value.round();
    }

    let scale = 10f64.powi(precision as i32);

    (value * scale).round() / scale
}

#[cfg(any(feature = "byte", feature = "bit"))]
#[cfg(not(feature = "std"))]
pub fn round_fractional_part_f64(value: f64, mut precision: usize) -> f64 {
    debug_assert!(value >= 0.0);

    let value = Decimal::from_f64(value).unwrap();

    if precision > 16 {
        precision = 16;
    } else if precision == 0 {
        return value.round().to_f64().unwrap();
    }

    let trunc = value.trunc();
    let mut fract = value.fract();

    let scale = Decimal::from(10u128.pow(precision as u32));
    fract = (fract * scale).round() / scale;

    (trunc + fract).to_f64().unwrap()
}

#[cfg(any(feature = "byte", feature = "bit"))]
#[inline]
pub(crate) fn is_zero_remainder_decimal(
    a: Decimal,
    b: Decimal,
    precision: usize,
) -> Option<Decimal> {
    debug_assert!(a.is_sign_positive() && b.is_sign_positive());
    debug_assert!(b > Decimal::ZERO);
    debug_assert!(precision <= 28);

    let quotient = a / b;

    let quotient_round = {
        if precision == 0 {
            quotient.round()
        } else {
            let trunc = quotient.trunc();
            let mut fract = quotient.fract();

            let scale = Decimal::from(10u128.pow(precision as u32));

            fract = (fract * scale).round() / scale;

            trunc + fract
        }
    };

    if b * quotient_round == a { Some(quotient_round) } else { None }
}
