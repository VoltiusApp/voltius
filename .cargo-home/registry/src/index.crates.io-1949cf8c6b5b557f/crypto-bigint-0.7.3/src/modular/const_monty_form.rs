//! Implements `ConstMontyForm`s, supporting modular arithmetic with a constant modulus.

mod add;
pub(super) mod invert;
mod lincomb;
mod mod_symbol;
mod mul;
mod neg;
mod pow;
mod reduce;
mod sqrt;
mod sub;

use super::{
    FixedMontyParams, PrimeParams, Retrieve, div_by_2::div_by_2, mul::mul_montgomery_form,
    reduction::montgomery_retrieve,
};
use crate::{ConstOne, ConstZero, CtEq, Odd, One, Uint, Zero};
use core::{fmt::Debug, marker::PhantomData};

#[cfg(feature = "rand_core")]
use crate::{Random, RandomMod, rand_core::TryRng};

#[cfg(feature = "serde")]
use {
    crate::Encoding,
    serdect::serde::de::Error,
    serdect::serde::{Deserialize, Deserializer, Serialize, Serializer},
};

/// Macros to remove the boilerplate code when dealing with constant moduli.
#[macro_use]
mod macros;
mod ct;

/// Trait representing a modulus and its associated constants for converting in and out of
/// Montgomery form.
///
/// To define a type which impls this trait, use the
/// [`const_monty_params!`][`crate::const_monty_params`] macro.
pub trait ConstMontyParams<const LIMBS: usize>:
    Copy + Debug + Default + Eq + Send + Sync + 'static
{
    /// Number of limbs required to encode the Montgomery form
    const LIMBS: usize;

    /// Montgomery parameters constant.
    const PARAMS: FixedMontyParams<LIMBS>;
}

/// Trait representing a prime modulus and its associated constants for converting in
/// and out of Montgomery form.
///
/// To define a type which impls this trait, use the
/// [`const_prime_monty_params!`][`crate::const_prime_monty_params`] macro.
pub trait ConstPrimeMontyParams<const LIMBS: usize>: ConstMontyParams<LIMBS> {
    /// Prime parameters constant.
    const PRIME_PARAMS: PrimeParams<LIMBS>;
}

/// An integer in Montgomery form modulo `MOD`, represented using `LIMBS` limbs.
/// The modulus is constant, so it cannot be set at runtime.
///
/// Internally, the value is stored in Montgomery form (multiplied by `MOD::PARAMS.one`) until it is retrieved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConstMontyForm<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> {
    montgomery_form: Uint<LIMBS>,
    phantom: PhantomData<MOD>,
}

#[cfg(feature = "zeroize")]
impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> zeroize::DefaultIsZeroes
    for ConstMontyForm<MOD, LIMBS>
{
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> ConstMontyForm<MOD, LIMBS> {
    /// The representation of 0 mod `MOD`.
    pub const ZERO: Self = Self {
        montgomery_form: Uint::<LIMBS>::ZERO,
        phantom: PhantomData,
    };

    /// The representation of 1 mod `MOD`.
    pub const ONE: Self = Self {
        montgomery_form: MOD::PARAMS.one,
        phantom: PhantomData,
    };

    /// Modulus as an unsigned integer.
    pub const MODULUS: Odd<Uint<LIMBS>> = *MOD::PARAMS.modulus();

    /// Instantiates a new [`ConstMontyForm`] that represents this `integer` mod `MOD`.
    #[must_use]
    pub const fn new(integer: &Uint<LIMBS>) -> Self {
        let montgomery_form = mul_montgomery_form(
            integer,
            &MOD::PARAMS.r2,
            &MOD::PARAMS.modulus,
            MOD::PARAMS.mod_neg_inv(),
        );

        Self {
            montgomery_form,
            phantom: PhantomData,
        }
    }

    /// Retrieves the integer currently encoded in this [`ConstMontyForm`], guaranteed to be reduced.
    #[must_use]
    pub const fn retrieve(&self) -> Uint<LIMBS> {
        montgomery_retrieve(
            &self.montgomery_form,
            &MOD::PARAMS.modulus,
            MOD::PARAMS.mod_neg_inv(),
        )
    }

    /// Access the `ConstMontyForm` value in Montgomery form.
    #[must_use]
    pub const fn as_montgomery(&self) -> &Uint<LIMBS> {
        &self.montgomery_form
    }

    /// Mutably access the `ConstMontyForm` value in Montgomery form.
    pub fn as_montgomery_mut(&mut self) -> &mut Uint<LIMBS> {
        &mut self.montgomery_form
    }

    /// Create a `ConstMontyForm` from a value in Montgomery form.
    #[must_use]
    pub const fn from_montgomery(integer: Uint<LIMBS>) -> Self {
        Self {
            montgomery_form: integer,
            phantom: PhantomData,
        }
    }

    /// Extract the value from the `ConstMontyForm` in Montgomery form.
    #[must_use]
    pub const fn to_montgomery(&self) -> Uint<LIMBS> {
        self.montgomery_form
    }

    /// Performs division by 2, that is returns `x` such that `x + x = self`.
    #[must_use]
    pub const fn div_by_2(&self) -> Self {
        Self {
            montgomery_form: div_by_2(&self.montgomery_form, &MOD::PARAMS.modulus),
            phantom: PhantomData,
        }
    }
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> Default for ConstMontyForm<MOD, LIMBS> {
    fn default() -> Self {
        Self::ZERO
    }
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> ConstZero for ConstMontyForm<MOD, LIMBS> {
    const ZERO: Self = Self::ZERO;
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> Zero for ConstMontyForm<MOD, LIMBS> {
    #[inline(always)]
    fn zero() -> Self {
        Self::ZERO
    }
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> num_traits::Zero
    for ConstMontyForm<MOD, LIMBS>
{
    fn zero() -> Self {
        Self::ZERO
    }

    fn is_zero(&self) -> bool {
        self.ct_eq(&Self::ZERO).into()
    }
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> ConstOne for ConstMontyForm<MOD, LIMBS> {
    const ONE: Self = Self::ONE;
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> One for ConstMontyForm<MOD, LIMBS> {
    #[inline(always)]
    fn one() -> Self {
        Self::ONE
    }
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> num_traits::One
    for ConstMontyForm<MOD, LIMBS>
{
    fn one() -> Self {
        Self::ONE
    }

    fn is_one(&self) -> bool {
        self.ct_eq(&Self::ONE).into()
    }
}

#[cfg(feature = "rand_core")]
impl<MOD, const LIMBS: usize> Random for ConstMontyForm<MOD, LIMBS>
where
    MOD: ConstMontyParams<LIMBS>,
{
    #[inline]
    fn try_random_from_rng<R: TryRng + ?Sized>(rng: &mut R) -> Result<Self, R::Error> {
        Ok(Self::new(&Uint::try_random_mod_vartime(
            rng,
            MOD::PARAMS.modulus.as_nz_ref(),
        )?))
    }
}

impl<MOD: ConstMontyParams<LIMBS>, const LIMBS: usize> Retrieve for ConstMontyForm<MOD, LIMBS> {
    type Output = Uint<LIMBS>;
    fn retrieve(&self) -> Self::Output {
        self.retrieve()
    }
}

#[cfg(feature = "serde")]
impl<'de, MOD, const LIMBS: usize> Deserialize<'de> for ConstMontyForm<MOD, LIMBS>
where
    MOD: ConstMontyParams<LIMBS>,
    Uint<LIMBS>: Encoding,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Uint::<LIMBS>::deserialize(deserializer).and_then(|montgomery_form| {
            if montgomery_form < MOD::PARAMS.modulus.0 {
                Ok(Self {
                    montgomery_form,
                    phantom: PhantomData,
                })
            } else {
                Err(D::Error::custom("montgomery form must be reduced"))
            }
        })
    }
}

#[cfg(feature = "serde")]
impl<MOD, const LIMBS: usize> Serialize for ConstMontyForm<MOD, LIMBS>
where
    MOD: ConstMontyParams<LIMBS>,
    Uint<LIMBS>: Encoding,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.montgomery_form.serialize(serializer)
    }
}
