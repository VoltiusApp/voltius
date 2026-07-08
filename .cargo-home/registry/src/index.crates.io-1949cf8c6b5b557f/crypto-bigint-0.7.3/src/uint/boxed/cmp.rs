//! [`BoxedUint`] comparisons.
//!
//! By default these are all constant-time and use the `subtle` crate.

pub(super) use core::cmp::{Ordering, max};

use super::BoxedUint;
use crate::{CtEq, UintRef};

impl BoxedUint {
    /// Returns the Ordering between `self` and `rhs` in variable time.
    #[must_use]
    pub fn cmp_vartime(&self, rhs: impl AsRef<UintRef>) -> Ordering {
        self.as_uint_ref().cmp_vartime(rhs.as_ref())
    }

    /// Determine in variable time whether the `self` is zero.
    pub(crate) fn is_zero_vartime(&self) -> bool {
        !self.limbs.iter().any(|l| l.0 != 0)
    }
}

impl Eq for BoxedUint {}

impl<Rhs: AsRef<UintRef> + ?Sized> PartialEq<Rhs> for BoxedUint {
    fn eq(&self, other: &Rhs) -> bool {
        self.ct_eq(other).into()
    }
}

impl Ord for BoxedUint {
    fn cmp(&self, other: &Self) -> Ordering {
        UintRef::cmp(self.as_uint_ref(), other.as_ref())
    }
}

impl<Rhs: AsRef<UintRef> + ?Sized> PartialOrd<Rhs> for BoxedUint {
    fn partial_cmp(&self, other: &Rhs) -> Option<Ordering> {
        Some(UintRef::cmp(self.as_uint_ref(), other.as_ref()))
    }
}

#[cfg(test)]
mod tests {
    use super::BoxedUint;
    use core::cmp::Ordering;

    #[test]
    fn cmp() {
        let a = BoxedUint::zero();
        let b = BoxedUint::one();
        let c = BoxedUint::max(128);

        assert_eq!(a.cmp(&b), Ordering::Less);
        assert_eq!(a.cmp(&c), Ordering::Less);
        assert_eq!(b.cmp(&c), Ordering::Less);

        assert_eq!(a.cmp(&a), Ordering::Equal);
        assert_eq!(b.cmp(&b), Ordering::Equal);
        assert_eq!(c.cmp(&c), Ordering::Equal);

        assert_eq!(b.cmp(&a), Ordering::Greater);
        assert_eq!(c.cmp(&a), Ordering::Greater);
        assert_eq!(c.cmp(&b), Ordering::Greater);
    }

    #[test]
    fn cmp_uintref() {
        let a = BoxedUint::zero();
        let b = BoxedUint::one();
        let c = BoxedUint::max(128);

        assert_eq!(a.partial_cmp(b.as_uint_ref()), Some(Ordering::Less));
        assert_eq!(a.partial_cmp(c.as_uint_ref()), Some(Ordering::Less));
        assert_eq!(b.partial_cmp(c.as_uint_ref()), Some(Ordering::Less));

        assert_eq!(a.partial_cmp(a.as_uint_ref()), Some(Ordering::Equal));
        assert_eq!(b.partial_cmp(b.as_uint_ref()), Some(Ordering::Equal));
        assert_eq!(c.partial_cmp(c.as_uint_ref()), Some(Ordering::Equal));

        assert_eq!(b.partial_cmp(a.as_uint_ref()), Some(Ordering::Greater));
        assert_eq!(c.partial_cmp(a.as_uint_ref()), Some(Ordering::Greater));
        assert_eq!(c.partial_cmp(b.as_uint_ref()), Some(Ordering::Greater));
    }
}
