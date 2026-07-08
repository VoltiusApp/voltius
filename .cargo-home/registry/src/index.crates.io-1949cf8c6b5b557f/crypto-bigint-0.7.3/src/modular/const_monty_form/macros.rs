//! [`ConstMontyForm`]/[`ConstMontyParams`] support macros.

#[cfg(doc)]
use crate::modular::{ConstMontyForm, ConstMontyParams, ConstPrimeMontyParams};

/// Create a type representing a modulus which impls the [`ConstMontyParams`] trait with the given
/// name, type, value (in big endian hex), and optional documentation string.
///
/// # Usage
///
/// ```
/// use crypto_bigint::{U256, const_monty_params};
///
/// const_monty_params!(
///     MyModulus,
///     U256,
///     "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001",
///     "Docs for my modulus"
/// );
/// ```
///
/// The modulus _must_ be odd, or this will panic.
// TODO: use `adt_const_params` when stable to make a `ConstMontyForm` generic around a modulus
#[macro_export]
macro_rules! const_monty_params {
    ($name:ident, $uint_type:ty, $value:expr) => {
        $crate::const_monty_params!(
            $name,
            $uint_type,
            $value,
            "Modulus which impls `ConstMontyParams`"
        );
    };
    ($name:ident, $uint_type:ty, $value:expr, $doc:expr) => {
        #[doc = $doc]
        #[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
        pub struct $name;
        impl $crate::modular::ConstMontyParams<{ <$uint_type>::LIMBS }> for $name {
            const LIMBS: usize = <$uint_type>::LIMBS;
            const PARAMS: $crate::modular::FixedMontyParams<{ <$uint_type>::LIMBS }> =
                $crate::modular::FixedMontyParams::new_vartime(
                    $crate::Odd::<$uint_type>::from_be_hex($value),
                );
        }
    };
}

/// Create a type representing a prime modulus which impls the [`ConstPrimeMontyParams`]
/// trait with the given name, type, value (in big endian hex), multiplicative generator,
/// and optional documentation string.
///
/// # Usage
///
/// ```
/// use crypto_bigint::{U256, const_prime_monty_params};
///
/// const_prime_monty_params!(
///     MyModulus,
///     U256,
///     "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001",
///     7,
///     "Docs for my modulus"
/// );
/// ```
///
/// The modulus _must_ be odd and prime, or this will panic.
#[macro_export]
macro_rules! const_prime_monty_params {
    ($name:ident, $uint_type:ty, $value:expr, $generator:literal) => {
        $crate::const_prime_monty_params!(
            $name,
            $uint_type,
            $value,
            $generator,
            "Modulus which impls `ConstPrimeMontyParams`"
        );
    };
    ($name:ident, $uint_type:ty, $value:expr, $generator:literal, $doc:expr) => {
        $crate::const_monty_params!($name, $uint_type, $value, $doc);

        impl $crate::modular::ConstPrimeMontyParams<{ <$uint_type>::LIMBS }> for $name {
            const PRIME_PARAMS: $crate::modular::PrimeParams<{ <$uint_type>::LIMBS }> =
                $crate::modular::PrimeParams::new_vartime(
                    &<$name as $crate::modular::ConstMontyParams<{ <$uint_type>::LIMBS }>>::PARAMS,
                    $generator,
                );
        }
    };
}

/// Creates a type alias to [`ConstMontyForm`] with the given [`ConstMontyParams`].
///
/// # Usage
///
/// ```
/// use crypto_bigint::{U256, modular::ConstMontyParams, const_monty_form};
/// #
/// # crypto_bigint::const_monty_params!(
/// #    MyModulus,
/// #    U256,
/// #    "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001",
/// #    "Docs for my modulus"
/// # );
///
/// const_monty_form!(MyFieldElement, MyModulus, "My field element");
/// ```
#[macro_export]
macro_rules! const_monty_form {
    ($name:ident, $modulus:ident) => {
        $crate::const_monty_form!(
            $name,
            $modulus,
            "Type alias for `ConstMontyForm` specialized for a particular modulus"
        );
    };
    ($name:ident, $modulus:ident, $doc:expr) => {
        #[doc = $doc]
        pub type $name = $crate::modular::ConstMontyForm<$modulus, { $modulus::LIMBS }>;
    };
}

/// Deprecated legacy macro which has been replaced by [`const_monty_form!`].
#[deprecated(since = "0.7.0", note = "use `const_monty_params!` instead")]
#[macro_export]
macro_rules! impl_modulus {
    ($name:ident, $uint_type:ty, $value:expr) => {
        $crate::const_monty_params!(
            $name,
            $uint_type,
            $value,
            "Modulus which impls `ConstMontyParams`"
        );
    };
    ($name:ident, $uint_type:ty, $value:expr, $doc:expr) => {
        $crate::const_monty_params!($name, $uint_type, $value, $doc);
    };
}

#[cfg(test)]
mod tests {
    use crate::modular::ConstMontyParams;
    use crate::{Limb, U64};

    #[test]
    fn new_params_with_valid_modulus() {
        const_monty_params!(Mod, U64, "0000000000000003");
        assert_eq!(
            Mod::PARAMS.mod_leading_zeros,
            core::cmp::min(Limb::BITS - 1, 62)
        );
    }

    /// Make sure the deprecated macro still works
    // TODO(tarcieri): remove this in the next breaking release
    #[test]
    #[allow(deprecated)]
    fn impl_modulus_with_valid_modulus() {
        impl_modulus!(Mod, U64, "0000000000000003");
        assert_eq!(
            Mod::PARAMS.mod_leading_zeros,
            core::cmp::min(Limb::BITS - 1, 62)
        );
    }
}
