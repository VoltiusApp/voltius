//! Components to build your own primality test.
//! Handle with care.

mod float;
mod gcd;
mod jacobi;
mod lucas;
mod miller_rabin;
mod precomputed;
mod primecount;
#[cfg(test)]
pub(crate) mod primes;
#[cfg(test)]
pub(crate) mod pseudoprimes;
mod sieve;

pub use lucas::{AStarBase, BruteForceBase, LucasBase, LucasCheck, SelfridgeBase, lucas_test};
pub use miller_rabin::{MillerRabin, minimum_mr_iterations};
pub use primecount::estimate_primecount;
pub use sieve::{SetBits, SieveFactory, SmallFactorsSieve, SmallFactorsSieveFactory, random_odd_integer};

pub(crate) use sieve::{ConventionsTestResult, conventions_test, equals_primitive, small_factors_test};

/// Possible results of various primality tests.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Primality {
    /// The number is definitely prime.
    Prime,
    /// The number is probably prime
    /// (see the documentation for the details about possible false positives).
    ProbablyPrime,
    /// The number is definitely composite.
    Composite,
}

impl Primality {
    /// Returns `true` if the result indicates that the number is definitely composite.
    pub fn is_composite(&self) -> bool {
        match self {
            Self::Prime => false,
            Self::ProbablyPrime => false,
            Self::Composite => true,
        }
    }

    /// Returns `true` if the result indicates that the number is probably or definitely prime.
    pub fn is_probably_prime(&self) -> bool {
        match self {
            Self::Prime => true,
            Self::ProbablyPrime => true,
            Self::Composite => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use alloc::format;

    use super::Primality;

    #[test]
    fn primality_derived_traits() {
        assert_eq!(format!("{:?}", Primality::Prime), "Prime");
        assert_eq!(Primality::Prime, Primality::Prime);
        assert!(Primality::Prime != Primality::ProbablyPrime);
        assert_eq!(Primality::Prime.clone(), Primality::Prime);
    }

    #[test]
    fn primality_to_bool() {
        assert!(Primality::Prime.is_probably_prime());
        assert!(Primality::ProbablyPrime.is_probably_prime());
        assert!(!Primality::Composite.is_probably_prime());

        assert!(!Primality::Prime.is_composite());
        assert!(!Primality::ProbablyPrime.is_composite());
        assert!(Primality::Composite.is_composite());
    }
}
