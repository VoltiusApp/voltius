//! Checked arithmetic.

use crate::{CheckedAdd, CheckedDiv, CheckedMul, CheckedSub, Choice, CtEq, CtOption, CtSelect};
use core::ops::{Add, Div, Mul, Sub};

#[cfg(feature = "serde")]
use serdect::serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Provides intentionally-checked arithmetic on `T`.
///
/// Internally this leverages the [`CtOption`] type from the [`ctutils`] crate in order to
/// handle overflows.
#[derive(Copy, Clone, Debug)]
pub struct Checked<T>(pub CtOption<T>);

impl<T> Checked<T> {
    /// Create a new checked arithmetic wrapper for the given value.
    pub const fn new(val: T) -> Self {
        Self(CtOption::some(val))
    }

    /// Create a new checked arithmetic wrapper for the given value.
    #[cfg(test)]
    pub(crate) fn none() -> Self
    where
        T: Default,
    {
        Self(CtOption::none())
    }
}

impl<T> Add<Self> for Checked<T>
where
    T: CheckedAdd + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn add(self, rhs: Self) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_add(rhs))),
        )
    }
}

impl<T> Add<&Self> for Checked<T>
where
    T: CheckedAdd + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn add(self, rhs: &Self) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_add(rhs))),
        )
    }
}

impl<T> Add<Checked<T>> for &Checked<T>
where
    T: CheckedAdd + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn add(self, rhs: Checked<T>) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_add(rhs))),
        )
    }
}

impl<T> Add<&Checked<T>> for &Checked<T>
where
    T: CheckedAdd + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn add(self, rhs: &Checked<T>) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_add(rhs))),
        )
    }
}

impl<T> Sub<Self> for Checked<T>
where
    T: CheckedSub + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn sub(self, rhs: Self) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_sub(rhs))),
        )
    }
}

impl<T> Sub<&Self> for Checked<T>
where
    T: CheckedSub + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn sub(self, rhs: &Self) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_sub(rhs))),
        )
    }
}

impl<T> Sub<Checked<T>> for &Checked<T>
where
    T: CheckedSub + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn sub(self, rhs: Checked<T>) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_sub(rhs))),
        )
    }
}

impl<T> Sub<&Checked<T>> for &Checked<T>
where
    T: CheckedSub + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn sub(self, rhs: &Checked<T>) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_sub(rhs))),
        )
    }
}

impl<T> Mul<Self> for Checked<T>
where
    T: CheckedMul + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn mul(self, rhs: Self) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_mul(rhs))),
        )
    }
}

impl<T> Mul<&Self> for Checked<T>
where
    T: CheckedMul + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn mul(self, rhs: &Self) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_mul(rhs))),
        )
    }
}

impl<T> Mul<Checked<T>> for &Checked<T>
where
    T: CheckedMul + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn mul(self, rhs: Checked<T>) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_mul(rhs))),
        )
    }
}

impl<T> Mul<&Checked<T>> for &Checked<T>
where
    T: CheckedMul + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn mul(self, rhs: &Checked<T>) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_mul(rhs))),
        )
    }
}

impl<T> Div<Self> for Checked<T>
where
    T: CheckedDiv + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn div(self, rhs: Self) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_div(rhs))),
        )
    }
}

impl<T> Div<&Self> for Checked<T>
where
    T: CheckedDiv + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn div(self, rhs: &Self) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_div(rhs))),
        )
    }
}

impl<T> Div<Checked<T>> for &Checked<T>
where
    T: CheckedDiv + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn div(self, rhs: Checked<T>) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_div(rhs))),
        )
    }
}

impl<T> Div<&Checked<T>> for &Checked<T>
where
    T: CheckedDiv + CtSelect + Default,
{
    type Output = Checked<T>;

    #[inline]
    fn div(self, rhs: &Checked<T>) -> Self::Output {
        Checked(
            self.0
                .as_ref()
                .and_then(|lhs| rhs.0.as_ref().and_then(|rhs| lhs.checked_div(rhs))),
        )
    }
}

impl<T> CtEq for Checked<T>
where
    T: CtEq,
{
    #[inline]
    fn ct_eq(&self, other: &Self) -> Choice {
        self.0.ct_eq(&other.0)
    }
}

impl<T> CtSelect for Checked<T>
where
    T: CtSelect,
{
    #[inline]
    fn ct_select(&self, other: &Self, choice: Choice) -> Self {
        Self(self.0.ct_select(&other.0, choice))
    }
}

impl<T> Default for Checked<T>
where
    T: Default,
{
    fn default() -> Self {
        Self::new(T::default())
    }
}

impl<T> From<Checked<T>> for CtOption<T> {
    fn from(checked: Checked<T>) -> CtOption<T> {
        checked.0
    }
}

impl<T> From<CtOption<T>> for Checked<T> {
    fn from(ct_option: CtOption<T>) -> Checked<T> {
        Checked(ct_option)
    }
}

impl<T> From<Checked<T>> for Option<T> {
    fn from(checked: Checked<T>) -> Option<T> {
        checked.0.into()
    }
}

#[cfg(feature = "serde")]
impl<'de, T: Default + Deserialize<'de>> Deserialize<'de> for Checked<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Option::<T>::deserialize(deserializer)?;
        let choice = Choice::from_u8_lsb(value.is_some().into());
        Ok(Self(CtOption::new(value.unwrap_or_default(), choice)))
    }
}

#[cfg(feature = "serde")]
impl<T: Copy + Serialize> Serialize for Checked<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.0.into_option().serialize(serializer)
    }
}

#[cfg(feature = "subtle")]
impl<T> subtle::ConditionallySelectable for Checked<T>
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
impl<T> subtle::ConstantTimeEq for Checked<T>
where
    Self: CtEq,
{
    #[inline]
    fn ct_eq(&self, rhs: &Self) -> subtle::Choice {
        CtEq::ct_eq(self, rhs).into()
    }
}

#[cfg(test)]
mod tests {
    use super::Checked;
    use crate::{
        CheckedAdd, CheckedDiv, CheckedMul, CheckedSub, Choice, CtEq, CtOption, CtSelect, Limb,
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
    fn checked_new() {
        assert_eq!(
            Checked::<Limb>::default().0.into_option(),
            Some(Limb::default())
        );
        for (a, _b) in INPUTS {
            assert_eq!(Checked::<Limb>::new(*a).0.into_option(), Some(*a));
        }
    }

    #[test]
    fn checked_eq_select() {
        let pairs: &[(Checked<Limb>, Checked<Limb>, bool)] = &[
            (Checked::none(), Checked::none(), true),
            (Checked::none(), Checked::new(Limb::ZERO), false),
            (Checked::new(Limb::ZERO), Checked::none(), false),
            (Checked::new(Limb::ZERO), Checked::new(Limb::ZERO), true),
            (Checked::new(Limb::ZERO), Checked::new(Limb::ONE), false),
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
    fn checked_from() {
        assert_eq!(Checked::<Limb>(CtOption::none()).0.into_option(), None);
        assert_eq!(
            Checked::<Limb>::default().0.into_option(),
            Checked::<Limb>::from(CtOption::<Limb>::some(Limb::default()))
                .0
                .into_option(),
        );
        assert_eq!(
            Checked::<Limb>::default().0.into_option(),
            Into::<Option<Limb>>::into(Checked::<Limb>::default())
        );
        assert_eq!(
            Checked::<Limb>::default().0.into_option(),
            Into::<CtOption<Limb>>::into(Checked::<Limb>::default()).into_option()
        );
    }

    #[allow(clippy::op_ref)]
    #[test]
    fn checked_add() {
        for (a, b) in INPUTS {
            let expect = a.checked_add(b).into_option();
            assert_eq!(
                (Checked::new(*a) + Checked::new(*b)).0.into_option(),
                expect
            );
            assert_eq!(
                (&Checked::new(*a) + Checked::new(*b)).0.into_option(),
                expect
            );
            assert_eq!(
                (Checked::new(*a) + &Checked::new(*b)).0.into_option(),
                expect
            );
            assert_eq!(
                (&Checked::new(*a) + &Checked::new(*b)).0.into_option(),
                expect
            );
        }
    }

    #[allow(clippy::op_ref)]
    #[test]
    fn checked_sub() {
        for (a, b) in INPUTS {
            let expect = a.checked_sub(b).into_option();
            assert_eq!(
                (Checked::new(*a) - Checked::new(*b)).0.into_option(),
                expect
            );
            assert_eq!(
                (&Checked::new(*a) - Checked::new(*b)).0.into_option(),
                expect
            );
            assert_eq!(
                (Checked::new(*a) - &Checked::new(*b)).0.into_option(),
                expect
            );
            assert_eq!(
                (&Checked::new(*a) - &Checked::new(*b)).0.into_option(),
                expect
            );
        }
    }

    #[allow(clippy::op_ref)]
    #[test]
    fn checked_mul() {
        for (a, b) in INPUTS {
            let expect = a.checked_mul(b).into_option();
            assert_eq!(
                (Checked::new(*a) * Checked::new(*b)).0.into_option(),
                expect
            );
            assert_eq!(
                (&Checked::new(*a) * Checked::new(*b)).0.into_option(),
                expect
            );
            assert_eq!(
                (Checked::new(*a) * &Checked::new(*b)).0.into_option(),
                expect
            );
            assert_eq!(
                (&Checked::new(*a) * &Checked::new(*b)).0.into_option(),
                expect
            );
        }
    }

    #[allow(clippy::op_ref)]
    #[test]
    fn checked_div() {
        for (a, b) in INPUTS {
            let expect = a.checked_div(b).into_option();
            assert_eq!(
                (Checked::new(*a) / Checked::new(*b)).0.into_option(),
                expect
            );
            assert_eq!(
                (&Checked::new(*a) / Checked::new(*b)).0.into_option(),
                expect
            );
            assert_eq!(
                (Checked::new(*a) / &Checked::new(*b)).0.into_option(),
                expect
            );
            assert_eq!(
                (&Checked::new(*a) / &Checked::new(*b)).0.into_option(),
                expect
            );
        }
    }
}
