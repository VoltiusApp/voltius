//! Wrapping arithmetic.

use crate::{
    Choice, CtEq, CtSelect, Integer, One, UintRef, WrappingAdd, WrappingMul, WrappingNeg,
    WrappingShl, WrappingShr, WrappingSub, Zero,
};
use core::{
    fmt,
    ops::{
        Add, BitAnd, BitAndAssign, BitOr, BitOrAssign, BitXor, BitXorAssign, Mul, Neg, Not, Shl,
        Shr, Sub,
    },
};

#[cfg(feature = "rand_core")]
use {crate::Random, rand_core::TryRng};

#[cfg(feature = "serde")]
use serdect::serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Provides intentionally-wrapped arithmetic on `T`.
///
/// This is analogous to [`core::num::Wrapping`] but allows this crate to
/// define trait impls for this type.
#[derive(Copy, Clone, Debug, Default, Eq, PartialEq, PartialOrd, Ord)]
pub struct Wrapping<T>(pub T);

impl<T: AsRef<UintRef>> AsRef<UintRef> for Wrapping<T> {
    fn as_ref(&self) -> &UintRef {
        self.0.as_ref()
    }
}

impl<T: AsMut<UintRef>> AsMut<UintRef> for Wrapping<T> {
    fn as_mut(&mut self) -> &mut UintRef {
        self.0.as_mut()
    }
}

impl<T: WrappingAdd> Add<Self> for Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn add(self, rhs: Self) -> Self::Output {
        Wrapping(self.0.wrapping_add(&rhs.0))
    }
}

impl<T: WrappingAdd> Add<&Self> for Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn add(self, rhs: &Self) -> Self::Output {
        Wrapping(self.0.wrapping_add(&rhs.0))
    }
}

impl<T: WrappingAdd> Add<Wrapping<T>> for &Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn add(self, rhs: Wrapping<T>) -> Self::Output {
        Wrapping(self.0.wrapping_add(&rhs.0))
    }
}

impl<T: WrappingAdd> Add<&Wrapping<T>> for &Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn add(self, rhs: &Wrapping<T>) -> Self::Output {
        Wrapping(self.0.wrapping_add(&rhs.0))
    }
}

impl<T: WrappingSub> Sub<Self> for Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn sub(self, rhs: Self) -> Self::Output {
        Wrapping(self.0.wrapping_sub(&rhs.0))
    }
}

impl<T: WrappingSub> Sub<&Self> for Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn sub(self, rhs: &Self) -> Self::Output {
        Wrapping(self.0.wrapping_sub(&rhs.0))
    }
}

impl<T: WrappingSub> Sub<Wrapping<T>> for &Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn sub(self, rhs: Wrapping<T>) -> Self::Output {
        Wrapping(self.0.wrapping_sub(&rhs.0))
    }
}

impl<T: WrappingSub> Sub<&Wrapping<T>> for &Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn sub(self, rhs: &Wrapping<T>) -> Self::Output {
        Wrapping(self.0.wrapping_sub(&rhs.0))
    }
}

impl<T: WrappingMul> Mul<Self> for Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn mul(self, rhs: Self) -> Self::Output {
        Wrapping(self.0.wrapping_mul(&rhs.0))
    }
}

impl<T: WrappingMul> Mul<&Self> for Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn mul(self, rhs: &Self) -> Self::Output {
        Wrapping(self.0.wrapping_mul(&rhs.0))
    }
}

impl<T: WrappingMul> Mul<Wrapping<T>> for &Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn mul(self, rhs: Wrapping<T>) -> Self::Output {
        Wrapping(self.0.wrapping_mul(&rhs.0))
    }
}

impl<T: WrappingMul> Mul<&Wrapping<T>> for &Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn mul(self, rhs: &Wrapping<T>) -> Self::Output {
        Wrapping(self.0.wrapping_mul(&rhs.0))
    }
}

impl<T: WrappingNeg> Neg for Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn neg(self) -> Self::Output {
        Wrapping(self.0.wrapping_neg())
    }
}

impl<T: WrappingNeg> Neg for &Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn neg(self) -> Self::Output {
        Wrapping(self.0.wrapping_neg())
    }
}

impl<T: WrappingShl> Shl<u32> for Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn shl(self, rhs: u32) -> Self::Output {
        Wrapping(self.0.wrapping_shl(rhs))
    }
}

impl<T: WrappingShl> Shl<u32> for &Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn shl(self, rhs: u32) -> Self::Output {
        Wrapping(self.0.wrapping_shl(rhs))
    }
}

impl<T: WrappingShr> Shr<u32> for Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn shr(self, rhs: u32) -> Self::Output {
        Wrapping(self.0.wrapping_shr(rhs))
    }
}

impl<T: WrappingShr> Shr<u32> for &Wrapping<T> {
    type Output = Wrapping<T>;

    #[inline]
    fn shr(self, rhs: u32) -> Self::Output {
        Wrapping(self.0.wrapping_shr(rhs))
    }
}

impl<T: Integer> BitAnd for Wrapping<T> {
    type Output = Self;

    fn bitand(self, rhs: Self) -> Wrapping<T> {
        Wrapping(self.0.bitand(&rhs.0))
    }
}

impl<T: Integer> BitAnd<&Wrapping<T>> for Wrapping<T> {
    type Output = Wrapping<T>;

    fn bitand(self, rhs: &Wrapping<T>) -> Wrapping<T> {
        Wrapping(self.0.bitand(&rhs.0))
    }
}

impl<T: Integer> BitAnd<Wrapping<T>> for &Wrapping<T> {
    type Output = Wrapping<T>;

    fn bitand(self, rhs: Wrapping<T>) -> Wrapping<T> {
        Wrapping(rhs.0.bitand(&self.0))
    }
}

impl<T: Integer> BitAnd<&Wrapping<T>> for &Wrapping<T> {
    type Output = Wrapping<T>;

    fn bitand(self, rhs: &Wrapping<T>) -> Wrapping<T> {
        Wrapping(self.0.clone().bitand(&rhs.0))
    }
}

impl<T: Integer> BitAndAssign for Wrapping<T> {
    fn bitand_assign(&mut self, other: Self) {
        self.0 &= other.0;
    }
}

impl<T: Integer> BitAndAssign<&Wrapping<T>> for Wrapping<T> {
    fn bitand_assign(&mut self, other: &Self) {
        self.0 &= &other.0;
    }
}

impl<T: Integer> BitOr for Wrapping<T> {
    type Output = Self;

    fn bitor(self, rhs: Self) -> Wrapping<T> {
        Wrapping(self.0.bitor(&rhs.0))
    }
}

impl<T: Integer> BitOr<&Wrapping<T>> for Wrapping<T> {
    type Output = Wrapping<T>;

    fn bitor(self, rhs: &Wrapping<T>) -> Wrapping<T> {
        Wrapping(self.0.bitor(&rhs.0))
    }
}

impl<T: Integer> BitOr<Wrapping<T>> for &Wrapping<T> {
    type Output = Wrapping<T>;

    fn bitor(self, rhs: Wrapping<T>) -> Wrapping<T> {
        Wrapping(rhs.0.bitor(&self.0))
    }
}

impl<T: Integer> BitOr<&Wrapping<T>> for &Wrapping<T> {
    type Output = Wrapping<T>;

    fn bitor(self, rhs: &Wrapping<T>) -> Wrapping<T> {
        Wrapping(self.0.clone().bitor(&rhs.0))
    }
}

impl<T: Integer> BitOrAssign for Wrapping<T> {
    fn bitor_assign(&mut self, other: Self) {
        self.0 |= other.0;
    }
}

impl<T: Integer> BitOrAssign<&Wrapping<T>> for Wrapping<T> {
    fn bitor_assign(&mut self, other: &Self) {
        self.0 |= &other.0;
    }
}

impl<T: Integer> BitXor for Wrapping<T> {
    type Output = Self;

    fn bitxor(self, rhs: Self) -> Wrapping<T> {
        Wrapping(self.0.bitxor(&rhs.0))
    }
}

impl<T: Integer> BitXor<&Wrapping<T>> for Wrapping<T> {
    type Output = Wrapping<T>;

    fn bitxor(self, rhs: &Wrapping<T>) -> Wrapping<T> {
        Wrapping(self.0.bitxor(&rhs.0))
    }
}

impl<T: Integer> BitXor<Wrapping<T>> for &Wrapping<T> {
    type Output = Wrapping<T>;

    fn bitxor(self, rhs: Wrapping<T>) -> Wrapping<T> {
        Wrapping(rhs.0.bitxor(&self.0))
    }
}

impl<T: Integer> BitXor<&Wrapping<T>> for &Wrapping<T> {
    type Output = Wrapping<T>;

    fn bitxor(self, rhs: &Wrapping<T>) -> Wrapping<T> {
        Wrapping(self.0.clone().bitxor(&rhs.0))
    }
}

impl<T: Integer> BitXorAssign for Wrapping<T> {
    fn bitxor_assign(&mut self, other: Self) {
        self.0 ^= other.0;
    }
}

impl<T: Integer> BitXorAssign<&Wrapping<T>> for Wrapping<T> {
    fn bitxor_assign(&mut self, other: &Self) {
        self.0 ^= &other.0;
    }
}

impl<T: Integer> Not for Wrapping<T> {
    type Output = Self;

    fn not(self) -> <Self as Not>::Output {
        Wrapping(self.0.not())
    }
}

impl<T: Integer> Not for &Wrapping<T> {
    type Output = Wrapping<T>;

    fn not(self) -> <Self as Not>::Output {
        Wrapping(self.0.clone().not())
    }
}

impl<T> CtEq for Wrapping<T>
where
    T: CtEq,
{
    #[inline]
    fn ct_eq(&self, other: &Self) -> Choice {
        CtEq::ct_eq(&self.0, &other.0)
    }
}

impl<T> CtSelect for Wrapping<T>
where
    T: CtSelect,
{
    #[inline]
    fn ct_select(&self, other: &Self, choice: Choice) -> Self {
        Self(self.0.ct_select(&other.0, choice))
    }
}

impl<T: Zero> Zero for Wrapping<T> {
    #[inline]
    fn zero() -> Self {
        Wrapping(T::zero())
    }
}

impl<T: One> One for Wrapping<T> {
    #[inline]
    fn one() -> Self {
        Wrapping(T::one())
    }
}

impl<T: num_traits::Zero + WrappingAdd> num_traits::Zero for Wrapping<T> {
    #[inline]
    fn zero() -> Self {
        Wrapping(T::zero())
    }

    #[inline]
    fn is_zero(&self) -> bool {
        self.0.is_zero()
    }
}

impl<T: num_traits::One + WrappingMul + PartialEq> num_traits::One for Wrapping<T> {
    #[inline]
    fn one() -> Self {
        Wrapping(T::one())
    }

    #[inline]
    fn is_one(&self) -> bool {
        self.0.is_one()
    }
}

impl<T: fmt::Display> fmt::Display for Wrapping<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl<T: fmt::Binary> fmt::Binary for Wrapping<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl<T: fmt::Octal> fmt::Octal for Wrapping<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl<T: fmt::LowerHex> fmt::LowerHex for Wrapping<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl<T: fmt::UpperHex> fmt::UpperHex for Wrapping<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

#[cfg(feature = "rand_core")]
impl<T: Random> Random for Wrapping<T> {
    fn try_random_from_rng<R: TryRng + ?Sized>(rng: &mut R) -> Result<Self, R::Error> {
        Ok(Wrapping(Random::try_random_from_rng(rng)?))
    }
}

#[cfg(feature = "serde")]
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Wrapping<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(Self(T::deserialize(deserializer)?))
    }
}

#[cfg(feature = "serde")]
impl<T: Serialize> Serialize for Wrapping<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.0.serialize(serializer)
    }
}

#[cfg(feature = "subtle")]
impl<T> subtle::ConditionallySelectable for Wrapping<T>
where
    T: Copy,
    Self: CtSelect,
{
    #[inline]
    fn conditional_select(a: &Self, b: &Self, choice: subtle::Choice) -> Self {
        a.ct_select(b, choice.into())
    }
}

#[cfg(feature = "subtle")]
impl<T> subtle::ConstantTimeEq for Wrapping<T>
where
    Self: CtEq,
{
    #[inline]
    fn ct_eq(&self, other: &Self) -> subtle::Choice {
        CtEq::ct_eq(self, other).into()
    }
}

#[cfg(test)]
#[allow(clippy::op_ref)]
mod tests {
    use super::Wrapping;
    use crate::{
        Choice, CtEq, CtSelect, Limb, WrappingAdd, WrappingMul, WrappingNeg, WrappingShl,
        WrappingShr, WrappingSub,
    };

    // FIXME Could use itertools combinations or an equivalent iterator
    const INPUTS: &[(Limb, Limb)] = &[
        (Limb::ZERO, Limb::ZERO),
        (Limb::ZERO, Limb::ONE),
        (Limb::ZERO, Limb::MAX),
        (Limb::ONE, Limb::ZERO),
        (Limb::ONE, Limb::ONE),
        (Limb::ONE, Limb::MAX),
        (Limb::MAX, Limb::ZERO),
        (Limb::MAX, Limb::ONE),
        (Limb::MAX, Limb::MAX),
    ];

    #[test]
    fn wrapping_new() {
        assert_eq!(Wrapping::<Limb>::default().0, Limb::default());
        assert_eq!(<Wrapping<Limb> as crate::Zero>::zero().0, Limb::ZERO);
        assert_eq!(<Wrapping<Limb> as crate::One>::one().0, Limb::ONE);
        assert_eq!(<Wrapping<Limb> as num_traits::Zero>::zero().0, Limb::ZERO);
        assert_eq!(<Wrapping<Limb> as num_traits::One>::one().0, Limb::ONE);
    }

    #[test]
    #[cfg(feature = "alloc")]
    fn wrapping_format() {
        for a in [Limb::ZERO, Limb::ONE, Limb::MAX] {
            assert_eq!(format!("{}", Wrapping(a)), format!("{}", a));
            assert_eq!(format!("{:?}", Wrapping(a)), format!("Wrapping({:?})", a));
            assert_eq!(format!("{:b}", Wrapping(a)), format!("{:b}", a));
            assert_eq!(format!("{:o}", Wrapping(a)), format!("{:o}", a));
            assert_eq!(format!("{:x}", Wrapping(a)), format!("{:x}", a));
            assert_eq!(format!("{:X}", Wrapping(a)), format!("{:X}", a));
        }
    }

    #[test]
    fn wrapping_eq_select() {
        let pairs: &[(Limb, Limb, bool)] = &[
            (Limb::ZERO, Limb::ZERO, true),
            (Limb::ZERO, Limb::ONE, false),
            (Limb::ONE, Limb::ZERO, false),
            (Limb::ONE, Limb::ONE, true),
        ];

        for (a, b, eq) in pairs {
            assert_eq!(a.ct_eq(b).to_bool(), *eq);
            assert!(a.ct_select(b, Choice::FALSE).ct_eq(a).to_bool());
            assert!(a.ct_select(b, Choice::TRUE).ct_eq(b).to_bool());
            #[cfg(feature = "subtle")]
            assert_eq!(bool::from(subtle::ConstantTimeEq::ct_eq(a, b)), *eq);
            #[cfg(feature = "subtle")]
            assert!(
                subtle::ConditionallySelectable::conditional_select(
                    a,
                    b,
                    subtle::Choice::from(0u8)
                )
                .ct_eq(a)
                .to_bool()
            );
            #[cfg(feature = "subtle")]
            assert!(
                subtle::ConditionallySelectable::conditional_select(
                    a,
                    b,
                    subtle::Choice::from(1u8)
                )
                .ct_eq(b)
                .to_bool()
            );
        }
    }

    #[test]
    fn wrapping_add() {
        for (a, b) in INPUTS {
            let expect = WrappingAdd::wrapping_add(a, b);
            assert_eq!((Wrapping(*a) + Wrapping(*b)).0, expect);
            assert_eq!((&Wrapping(*a) + Wrapping(*b)).0, expect);
            assert_eq!((Wrapping(*a) + &Wrapping(*b)).0, expect);
            assert_eq!((&Wrapping(*a) + &Wrapping(*b)).0, expect);
        }
    }

    #[test]
    fn wrapping_sub() {
        for (a, b) in INPUTS {
            let expect = WrappingSub::wrapping_sub(a, b);
            assert_eq!((Wrapping(*a) - Wrapping(*b)).0, expect);
            assert_eq!((&Wrapping(*a) - Wrapping(*b)).0, expect);
            assert_eq!((Wrapping(*a) - &Wrapping(*b)).0, expect);
            assert_eq!((&Wrapping(*a) - &Wrapping(*b)).0, expect);
        }
    }

    #[test]
    fn wrapping_mul() {
        for (a, b) in INPUTS {
            let expect = WrappingMul::wrapping_mul(a, b);
            assert_eq!((Wrapping(*a) * Wrapping(*b)).0, expect);
            assert_eq!((&Wrapping(*a) * Wrapping(*b)).0, expect);
            assert_eq!((Wrapping(*a) * &Wrapping(*b)).0, expect);
            assert_eq!((&Wrapping(*a) * &Wrapping(*b)).0, expect);
        }
    }

    #[test]
    fn wrapping_neg() {
        for a in [Limb::ZERO, Limb::ONE, Limb::MAX] {
            let expect = WrappingNeg::wrapping_neg(&a);
            assert_eq!((-Wrapping(a)).0, expect);
        }
    }

    #[test]
    fn wrapping_shift() {
        for a in [Limb::ZERO, Limb::ONE, Limb::MAX] {
            assert_eq!((Wrapping(a) << 1).0, WrappingShl::wrapping_shl(&a, 1));
            assert_eq!((&Wrapping(a) << 2).0, WrappingShl::wrapping_shl(&a, 2));
            assert_eq!((Wrapping(a) >> 1).0, WrappingShr::wrapping_shr(&a, 1));
            assert_eq!((&Wrapping(a) >> 2).0, WrappingShr::wrapping_shr(&a, 2));
        }
    }

    #[test]
    fn wrapping_bitand() {
        for (a, b) in INPUTS {
            let expect = *a & b;
            assert_eq!((Wrapping(*a) & Wrapping(*b)).0, expect);
            assert_eq!((&Wrapping(*a) & Wrapping(*b)).0, expect);
            assert_eq!((Wrapping(*a) & &Wrapping(*b)).0, expect);
            assert_eq!((&Wrapping(*a) & &Wrapping(*b)).0, expect);
            let mut c = Wrapping(*a);
            c &= Wrapping(*b);
            assert_eq!(c.0, expect);
            let mut c = Wrapping(*a);
            c &= &Wrapping(*b);
            assert_eq!(c.0, expect);
        }
    }

    #[test]
    fn wrapping_bitor() {
        for (a, b) in INPUTS {
            let expect = *a | b;
            assert_eq!((Wrapping(*a) | Wrapping(*b)).0, expect);
            assert_eq!((&Wrapping(*a) | Wrapping(*b)).0, expect);
            assert_eq!((Wrapping(*a) | &Wrapping(*b)).0, expect);
            assert_eq!((&Wrapping(*a) | &Wrapping(*b)).0, expect);
            let mut c = Wrapping(*a);
            c |= Wrapping(*b);
            assert_eq!(c.0, expect);
            let mut c = Wrapping(*a);
            c |= &Wrapping(*b);
            assert_eq!(c.0, expect);
        }
    }

    #[test]
    fn wrapping_bitxor() {
        for (a, b) in INPUTS {
            let expect = *a ^ b;
            assert_eq!((Wrapping(*a) ^ Wrapping(*b)).0, expect);
            assert_eq!((&Wrapping(*a) ^ Wrapping(*b)).0, expect);
            assert_eq!((Wrapping(*a) ^ &Wrapping(*b)).0, expect);
            assert_eq!((&Wrapping(*a) ^ &Wrapping(*b)).0, expect);
            let mut c = Wrapping(*a);
            c ^= Wrapping(*b);
            assert_eq!(c.0, expect);
            let mut c = Wrapping(*a);
            c ^= &Wrapping(*b);
            assert_eq!(c.0, expect);
        }
    }

    #[test]
    fn wrapping_bitnot() {
        for a in [Limb::ZERO, Limb::ONE, Limb::MAX] {
            let expect = !a;
            assert_eq!((!Wrapping(a)).0, expect);
            assert_eq!((!(&Wrapping(a))).0, expect);
        }
    }
}
