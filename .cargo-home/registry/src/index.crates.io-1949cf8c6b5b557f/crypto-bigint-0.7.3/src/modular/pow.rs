use super::FixedMontyParams;
use super::mul::{almost_montgomery_reduce, mul_montgomery_form, square_repeat_montgomery_form};
use crate::{AmmMultiplier, CtEq, Limb, MontyForm, Uint, UnsignedWithMontyForm, Word, word};
use core::{array, mem};

#[cfg(feature = "alloc")]
use alloc::vec::Vec;

const WINDOW: u32 = 4;
const WINDOW_COUNT: usize = 1 << WINDOW;
const WINDOW_MASK: Word = (1 << WINDOW) - 1;
#[allow(clippy::integer_division_remainder_used, reason = "constant")]
const BITS_PER_WINDOW: u32 = Limb::BITS / WINDOW;

/// Performs modular exponentiation using Montgomery's ladder.
/// `exponent_bits` represents the number of bits to take into account for the exponent.
///
/// NOTE: the value of `exponent_bits` is leaked in the time pattern.
pub const fn pow_montgomery_form<
    const LIMBS: usize,
    const RHS_LIMBS: usize,
    const VARTIME: bool,
>(
    x: &Uint<LIMBS>,
    exponent: &Uint<RHS_LIMBS>,
    exponent_bits: u32,
    params: &FixedMontyParams<LIMBS>,
) -> Uint<LIMBS> {
    multi_exponentiate_montgomery_form_array::<LIMBS, RHS_LIMBS, 1, VARTIME>(
        &[(*x, *exponent)],
        exponent_bits,
        params,
    )
}

/// Performs modular exponentiation using "Almost Montgomery Multiplication".
///
/// Returns a result which has been fully reduced by the modulus specified in `params`.
///
/// `exponent_bits` represents the length of the exponent in bits.
///
/// NOTE: `exponent_bits` is leaked in the time pattern.
pub fn pow_montgomery_form_amm<'a, U>(
    x: &U,
    exponent: &U,
    exponent_bits: u32,
    params: &'a <U::MontyForm as MontyForm>::Params,
) -> U
where
    U: UnsignedWithMontyForm,
    <U::MontyForm as MontyForm>::Multiplier<'a>: AmmMultiplier<'a>,
{
    let one = params.as_ref().one().clone();

    if exponent_bits == 0 {
        return one; // 1 in Montgomery form
    }

    let mut multiplier = <U::MontyForm as MontyForm>::Multiplier::from(params);
    let mut power = x.clone();

    // powers[i] contains x^i
    let powers: [U; WINDOW_COUNT] = array::from_fn(|n| {
        if n == 0 {
            one.clone()
        } else if n == WINDOW_COUNT - 1 {
            power.clone()
        } else {
            let mut new_power = power.clone();
            multiplier.mul_amm_assign(&mut new_power, x);

            mem::swap(&mut power, &mut new_power);
            new_power
        }
    });

    let (starting_limb, starting_window, starting_window_mask) = pow_init(exponent_bits);

    let mut z = one; // 1 in Montgomery form
    let mut power = powers[0].clone();

    for limb_num in (0..=starting_limb).rev() {
        let w = exponent.as_limbs()[limb_num].0;

        let mut window_num = if limb_num == starting_limb {
            starting_window + 1
        } else {
            BITS_PER_WINDOW
        };

        while window_num > 0 {
            window_num -= 1;

            let mut idx = (w >> (window_num * WINDOW)) & WINDOW_MASK;

            if limb_num == starting_limb && window_num == starting_window {
                idx &= starting_window_mask;
            } else {
                for _ in 1..=WINDOW {
                    multiplier.square_amm_assign(&mut z);
                }
            }

            // Constant-time lookup in the array of powers
            power.as_mut_limbs().copy_from_slice(powers[0].as_limbs());
            for i in 1..WINDOW_COUNT {
                power.ct_assign(&powers[i], (i as Word).ct_eq(&idx));
            }

            multiplier.mul_amm_assign(&mut z, &power);
        }
    }

    almost_montgomery_reduce(z.as_mut(), params.as_ref().modulus().as_uint_ref());
    z
}

pub const fn multi_exponentiate_montgomery_form_array<
    const LIMBS: usize,
    const RHS_LIMBS: usize,
    const N: usize,
    const VARTIME: bool,
>(
    bases_and_exponents: &[(Uint<LIMBS>, Uint<RHS_LIMBS>); N],
    exponent_bits: u32,
    params: &FixedMontyParams<LIMBS>,
) -> Uint<LIMBS> {
    if exponent_bits == 0 {
        return *params.one(); // 1 in Montgomery form
    }

    let mut powers_and_exponents =
        [([Uint::<LIMBS>::ZERO; WINDOW_COUNT], Uint::<RHS_LIMBS>::ZERO); N];

    let mut i = 0;
    while i < N {
        let (base, exponent) = bases_and_exponents[i];
        powers_and_exponents[i] = (compute_powers(&base, params), exponent);
        i += 1;
    }

    multi_exponentiate_montgomery_form_internal::<LIMBS, RHS_LIMBS, VARTIME>(
        &powers_and_exponents,
        exponent_bits,
        params,
    )
}

/// Performs modular multi-exponentiation using Montgomery's ladder.
/// `exponent_bits` represents the number of bits to take into account for the exponent.
///
/// See: Straus, E. G. Problems and solutions: Addition chains of vectors. American Mathematical Monthly 71 (1964), 806–808.
///
/// NOTE: this value is leaked in the time pattern.
#[cfg(feature = "alloc")]
pub fn multi_exponentiate_montgomery_form_slice<
    const LIMBS: usize,
    const RHS_LIMBS: usize,
    const VARTIME: bool,
>(
    bases_and_exponents: &[(Uint<LIMBS>, Uint<RHS_LIMBS>)],
    exponent_bits: u32,
    params: &FixedMontyParams<LIMBS>,
) -> Uint<LIMBS> {
    if exponent_bits == 0 {
        return *params.one(); // 1 in Montgomery form
    }

    let powers_and_exponents: Vec<([Uint<LIMBS>; WINDOW_COUNT], Uint<RHS_LIMBS>)> =
        bases_and_exponents
            .iter()
            .map(|(base, exponent)| (compute_powers(base, params), *exponent))
            .collect();

    multi_exponentiate_montgomery_form_internal::<LIMBS, RHS_LIMBS, VARTIME>(
        powers_and_exponents.as_slice(),
        exponent_bits,
        params,
    )
}

const fn compute_powers<const LIMBS: usize>(
    x: &Uint<LIMBS>,
    params: &FixedMontyParams<LIMBS>,
) -> [Uint<LIMBS>; WINDOW_COUNT] {
    // powers[i] contains x^i
    let mut powers = [*params.one(); WINDOW_COUNT];
    powers[1] = *x;

    let mut i = 2;
    while i < powers.len() {
        powers[i] = mul_montgomery_form(&powers[i - 1], x, params.modulus(), params.mod_neg_inv());
        i += 1;
    }

    powers
}

#[allow(clippy::cast_possible_truncation)]
const fn multi_exponentiate_montgomery_form_internal<
    const LIMBS: usize,
    const RHS_LIMBS: usize,
    const VARTIME: bool,
>(
    powers_and_exponents: &[([Uint<LIMBS>; WINDOW_COUNT], Uint<RHS_LIMBS>)],
    exponent_bits: u32,
    params: &FixedMontyParams<LIMBS>,
) -> Uint<LIMBS> {
    let (starting_limb, starting_window, starting_window_mask) = pow_init(exponent_bits);

    let mut z = *params.one(); // 1 in Montgomery form

    let mut limb_num = starting_limb + 1;
    while limb_num > 0 {
        limb_num -= 1;

        let mut window_num = if limb_num == starting_limb {
            starting_window + 1
        } else {
            BITS_PER_WINDOW
        };
        while window_num > 0 {
            window_num -= 1;

            if limb_num != starting_limb || window_num != starting_window {
                z = square_repeat_montgomery_form(
                    &z,
                    WINDOW,
                    params.modulus(),
                    params.mod_neg_inv(),
                );
            }

            let mut i = 0;
            while i < powers_and_exponents.len() {
                let (powers, exponent) = &powers_and_exponents[i];
                let w = exponent.as_limbs()[limb_num].0;
                let mut idx = (w >> (window_num * WINDOW)) & WINDOW_MASK;

                if limb_num == starting_limb && window_num == starting_window {
                    idx &= starting_window_mask;
                }

                if VARTIME {
                    if idx > 0 {
                        z = mul_montgomery_form(
                            &z,
                            &powers[idx as usize],
                            params.modulus(),
                            params.mod_neg_inv(),
                        );
                    }
                } else {
                    // Constant-time lookup in the array of powers
                    let mut power = powers[0];
                    let mut j = 1;
                    while j < WINDOW_COUNT {
                        let choice = word::choice_from_eq(j as Word, idx);
                        power = Uint::<LIMBS>::select(&power, &powers[j], choice);
                        j += 1;
                    }
                    z = mul_montgomery_form(&z, &power, params.modulus(), params.mod_neg_inv());
                }

                i += 1;
            }
        }
    }

    z
}

// Note: this performs non-constant-time operations but the rustdoc already notes that
// `exponent_bits` is almost unavoidably leaked via timing already since it bounds the number
// of computations we perform
#[allow(clippy::integer_division_remainder_used, reason = "public parameter")]
const fn pow_init(exponent_bits: u32) -> (usize, u32, Word) {
    let starting_limb = ((exponent_bits - 1) / Limb::BITS) as usize;
    let starting_bit_in_limb = (exponent_bits - 1) % Limb::BITS;
    let starting_window = starting_bit_in_limb / WINDOW;
    let starting_window_mask = (1 << (starting_bit_in_limb % WINDOW + 1)) - 1;
    (starting_limb, starting_window, starting_window_mask)
}
