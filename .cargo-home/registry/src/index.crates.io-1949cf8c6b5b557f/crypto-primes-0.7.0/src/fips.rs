//! Functions implementing the functionality prescribed by FIPS-186.5 standard[^FIPS].
//!
//! [^FIPS]: FIPS-186.5 standard, <https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.186-5.pdf>

use crypto_bigint::{RandomMod, UnsignedWithMontyForm};
use rand_core::CryptoRng;

use crate::{
    hazmat::{
        ConventionsTestResult, LucasCheck, MillerRabin, Primality, SelfridgeBase, conventions_test, equals_primitive,
        lucas_test, minimum_mr_iterations, small_factors_test,
    },
    presets::Flavor,
};

/// Options for FIPS primality testing.
#[derive(Copy, Clone, Debug)]
pub struct FipsOptions {
    mr_iterations: usize,
    add_lucas_test: bool,
    add_trial_division_test: bool,
}

impl FipsOptions {
    /// Use a precalculated number of Miller-Rabin iterations (see [`MillerRabin`] for details).
    ///
    /// The number of iterations given the required error bound can be calculated with
    /// [`minimum_mr_iterations`](`crate::hazmat::minimum_mr_iterations`).
    pub const fn with_mr_iterations(mr_iterations: usize) -> Self {
        Self {
            mr_iterations,
            add_lucas_test: false,
            add_trial_division_test: false,
        }
    }

    /// Use the minimum number of Miller-Rabin iterations (see [`MillerRabin`] for details)
    /// required for the error to be below `1/2^log2_target` for candidates of size `bit_length`.
    pub const fn with_error_bound(bit_length: u32, log2_target: u32) -> Option<Self> {
        let iterations = match minimum_mr_iterations(bit_length, log2_target) {
            None => return None,
            Some(iterations) => iterations,
        };
        Some(Self::with_mr_iterations(iterations))
    }

    /// Use an additional strong Lucas test with Selfridge base (see [`lucas_test`] and [`SelfridgeBase`] for details).
    ///
    /// `false` by default.
    pub const fn with_lucas_test(self) -> Self {
        Self {
            mr_iterations: self.mr_iterations,
            add_lucas_test: true,
            add_trial_division_test: self.add_trial_division_test,
        }
    }

    /// Use a trial division as explained in Appendix B.3.
    ///
    /// `false` by default.
    ///
    /// Note that it is a performance optimization for the cases when you expect the candidates to be random
    /// (and thus likely to have small factors).
    /// It does not affect the failure probability of the primality check.
    pub const fn with_trial_division_test(self) -> Self {
        Self {
            mr_iterations: self.mr_iterations,
            add_lucas_test: self.add_lucas_test,
            add_trial_division_test: true,
        }
    }
}

/// Probabilistically checks if the given number is prime using the provided RNG
/// according to FIPS-186.5[^FIPS] standard.
///
/// By default, performs `mr_iterations` of Miller-Rabin check with random bases.
/// See [`MillerRabin`] and [`lucas_test`] for more details about the checks;
/// use [`minimum_mr_iterations`](`crate::hazmat::minimum_mr_iterations`)
/// to calculate the number of required iterations.
///
/// Additional checks can be specified in the [`FipsOptions`] structure.
///
/// [^FIPS]: FIPS-186.5 standard, <https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.186-5.pdf>
pub fn is_prime<T>(rng: &mut (impl CryptoRng + ?Sized), flavor: Flavor, candidate: &T, options: FipsOptions) -> bool
where
    T: UnsignedWithMontyForm + RandomMod,
{
    match flavor {
        Flavor::Any => {}
        Flavor::Safe => return is_safe_prime(rng, candidate, options),
    }

    let odd_candidate = match conventions_test(candidate.clone()) {
        ConventionsTestResult::Prime => return true,
        ConventionsTestResult::Composite => return false,
        ConventionsTestResult::Undecided { odd_candidate } => odd_candidate,
    };

    if options.add_trial_division_test && small_factors_test(&odd_candidate) == Primality::Composite {
        return false;
    }

    // The random base test only makes sense when `candidate > 3`.
    if equals_primitive(candidate, 3) {
        return true;
    }

    let mr = MillerRabin::new(odd_candidate.clone());
    for _ in 0..options.mr_iterations {
        if mr.test_random_base(rng).is_composite() {
            return false;
        }
    }

    if options.add_lucas_test {
        return lucas_test(odd_candidate, SelfridgeBase, LucasCheck::Strong).is_probably_prime();
    }

    true
}

/// Probabilistically checks if the given number is a safe prime using the provided RNG
/// according to FIPS-186.5[^FIPS] standard.
///
/// See [`fips_is_prime`] for details about the performed checks.
///
/// [^FIPS]: FIPS-186.5 standard, <https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.186-5.pdf>
fn is_safe_prime<T>(rng: &mut (impl CryptoRng + ?Sized), candidate: &T, options: FipsOptions) -> bool
where
    T: UnsignedWithMontyForm + RandomMod,
{
    // Since, by the definition of safe prime, `(candidate - 1) / 2` must also be prime,
    // and therefore odd, `candidate` has to be equal to 3 modulo 4.
    // 5 is the only exception, so we check for it.
    if equals_primitive(candidate, 5) {
        return true;
    }

    // Safe primes are always of the form 4k + 3 (i.e. n ≡ 3 mod 4)
    // The last two digits of a binary number give you its value modulo 4.
    // Primes p=4n+3 will always end in 11 in binary because p ≡ 3 mod 4.
    if candidate.as_limbs()[0].0 & 3 != 3 {
        return false;
    }

    is_prime(rng, Flavor::Any, candidate, options)
        && is_prime(rng, Flavor::Any, &candidate.wrapping_shr_vartime(1), options)
}

#[cfg(test)]
mod tests {
    use crypto_bigint::U64;

    use super::{FipsOptions, is_prime};
    use crate::Flavor;

    #[test]
    fn cannot_create_options() {
        // Test the case where the requested error probability cannot be reached.
        assert!(FipsOptions::with_error_bound(128, 1024).is_none());
    }

    #[test]
    fn trial_division_only() {
        let mut rng = rand::rng();

        assert!(is_prime(
            &mut rng,
            Flavor::Any,
            &U64::from(4651u64),
            FipsOptions::with_mr_iterations(0).with_trial_division_test(),
        ));
        assert!(!is_prime(
            &mut rng,
            Flavor::Any,
            &U64::from(113u64 * 137),
            FipsOptions::with_mr_iterations(0).with_trial_division_test(),
        ));
    }

    #[test]
    fn lucas_test_only() {
        let mut rng = rand::rng();

        assert!(is_prime(
            &mut rng,
            Flavor::Any,
            &U64::from(4651u64),
            FipsOptions::with_mr_iterations(0).with_lucas_test(),
        ));
        assert!(!is_prime(
            &mut rng,
            Flavor::Any,
            &U64::from(113u64 * 137),
            FipsOptions::with_mr_iterations(0).with_lucas_test(),
        ));

        // 5459 = 53 * 103 is a Lucas pseudoprime (strong Lucas + Selfridge base),
        // that is it's a composite, but Lucas test reports it to be prime.
        // This checks that we really only run the Lucas test.
        assert!(is_prime(
            &mut rng,
            Flavor::Any,
            &U64::from(53u64 * 103),
            FipsOptions::with_mr_iterations(0).with_lucas_test(),
        ));
    }

    #[test]
    fn no_tests() {
        let mut rng = rand::rng();

        // When no tests at all are run, everything is a pseudoprime
        assert!(is_prime(
            &mut rng,
            Flavor::Any,
            &U64::from(4651u64),
            FipsOptions::with_mr_iterations(0)
        ));
    }
}
