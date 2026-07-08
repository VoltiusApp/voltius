use super::truncate::Truncate;

use array::{Array, ArraySize, typenum::U256};
use core::fmt::Debug;
use core::ops::{Add, Mul, Neg, Sub};
use num_traits::PrimInt;

#[cfg(feature = "ctutils")]
use ctutils::{Choice, CtEq, CtEqSlice};
#[cfg(feature = "zeroize")]
use zeroize::Zeroize;

/// Finite field with efficient modular reduction for lattice-based cryptography.
pub trait Field: Copy + Default + Debug + PartialEq {
    /// Base integer type used to represent field elements
    type Int: PrimInt + Default + Debug + From<u8> + Into<u128> + Into<Self::Long> + Truncate<u128>;
    /// Double-width integer type used for intermediate computations.
    type Long: PrimInt + From<Self::Int>;
    /// Quadruple-width integer type used for Barrett reduction.
    type LongLong: PrimInt;

    /// Field modulus.
    const Q: Self::Int;
    /// Field modulus as [`Self::Long`].
    const QL: Self::Long;
    /// Field modulus as [`Self::LongLong`].
    const QLL: Self::LongLong;

    /// Bit shift used in Barrett reduction.
    const BARRETT_SHIFT: usize;
    /// Precomputed multiplier for Barrett reduction.
    const BARRETT_MULTIPLIER: Self::LongLong;

    /// Reduce a value that's already close to the modulus range.
    fn small_reduce(x: Self::Int) -> Self::Int;
    /// Reduce a wider value to a field element using Barrett reduction.
    fn barrett_reduce(x: Self::Long) -> Self::Int;
}

/// The `define_field` macro creates a zero-sized struct and an implementation of the [`Field`]
/// trait for that struct.  The caller must specify:
///
/// * `$field`: The name of the zero-sized struct to be created
/// * `$q`: The prime number that defines the field.
/// * `$int`: The primitive integer type to be used to represent members of the field
/// * `$long`: The primitive integer type to be used to represent products of two field members.
///   This type should have roughly twice the bits of `$int`.
/// * `$longlong`: The primitive integer type to be used to represent products of three field
///   members. This type should have roughly four times the bits of `$int`.
#[macro_export]
macro_rules! define_field {
    ($field:ident, $int:ty, $long:ty, $longlong:ty, $q:literal) => {
        $crate::define_field!($field, $int, $long, $longlong, $q, "Finite field");
    };
    ($field:ident, $int:ty, $long:ty, $longlong:ty, $q:literal, $doc:expr) => {
        #[doc = $doc]
        #[derive(Copy, Clone, Default, Debug, Eq, PartialEq)]
        pub struct $field;

        impl $crate::Field for $field {
            type Int = $int;
            type Long = $long;
            type LongLong = $longlong;

            const Q: Self::Int = $q;
            const QL: Self::Long = $q;
            const QLL: Self::LongLong = $q;

            #[allow(clippy::as_conversions)]
            const BARRETT_SHIFT: usize = 2 * (Self::Q.ilog2() + 1) as usize;
            #[allow(clippy::integer_division_remainder_used)]
            const BARRETT_MULTIPLIER: Self::LongLong = (1 << Self::BARRETT_SHIFT) / Self::QLL;

            fn small_reduce(x: Self::Int) -> Self::Int {
                // Branchless conditional subtraction: if x >= Q, subtract Q; else
                // leave x alone. Compilers already emit `csel` here at O2, but the
                // explicit mask form removes the dependency on optimizer choices
                // and keeps the generated assembly free of secret-dependent control
                // flow at every optimization level.
                let mask = ((x >= Self::Q) as $int).wrapping_neg();
                x - (Self::Q & mask)
            }

            fn barrett_reduce(x: Self::Long) -> Self::Int {
                let x: Self::LongLong = x.into();
                let product = x * Self::BARRETT_MULTIPLIER;
                let quotient = product >> Self::BARRETT_SHIFT;
                let remainder = x - quotient * Self::QLL;
                Self::small_reduce($crate::Truncate::truncate(remainder))
            }
        }
    };
}

/// An [`Elem`] is a member of the specified prime-order field.
///
/// Elements can be added, subtracted, multiplied, and negated, and the overloaded operators will
/// ensure both that the integer values remain in the field, and that the reductions are done
/// efficiently.
///
/// For addition and subtraction, a simple conditional subtraction is used; for multiplication,
/// Barrett reduction.
#[derive(Copy, Clone, Default, Debug, Eq, PartialEq)]
pub struct Elem<F: Field>(pub F::Int);

impl<F: Field> Elem<F> {
    /// Create a new field element.
    pub const fn new(x: F::Int) -> Self {
        Self(x)
    }
}

#[cfg(feature = "ctutils")]
impl<F: Field> CtEq for Elem<F>
where
    F::Int: CtEq,
{
    fn ct_eq(&self, other: &Self) -> Choice {
        self.0.ct_eq(&other.0)
    }
}

#[cfg(feature = "ctutils")]
impl<F: Field<Int: CtEq>> CtEqSlice for Elem<F> {}

#[cfg(feature = "zeroize")]
impl<F: Field> Zeroize for Elem<F>
where
    F::Int: Zeroize,
{
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl<F: Field> Neg for Elem<F> {
    type Output = Elem<F>;

    fn neg(self) -> Elem<F> {
        Elem(F::small_reduce(F::Q - self.0))
    }
}

impl<F: Field> Add<Elem<F>> for Elem<F> {
    type Output = Elem<F>;

    fn add(self, rhs: Elem<F>) -> Elem<F> {
        Elem(F::small_reduce(self.0 + rhs.0))
    }
}

impl<F: Field> Sub<Elem<F>> for Elem<F> {
    type Output = Elem<F>;

    fn sub(self, rhs: Elem<F>) -> Elem<F> {
        Elem(F::small_reduce(self.0 + F::Q - rhs.0))
    }
}

impl<F: Field> Mul<Elem<F>> for Elem<F> {
    type Output = Elem<F>;

    fn mul(self, rhs: Elem<F>) -> Elem<F> {
        let lhs: F::Long = self.0.into();
        let rhs: F::Long = rhs.0.into();
        let prod = lhs * rhs;
        Elem(F::barrett_reduce(prod))
    }
}

/// A `Polynomial` is a member of the ring `R_q = Z_q[X] / (X^256)` of degree-256 polynomials
/// over the finite field with prime order `q`.
///
/// Polynomials can be added, subtracted, negated, and multiplied by field elements.
#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct Polynomial<F: Field>(pub Array<Elem<F>, U256>);

impl<F: Field> Polynomial<F> {
    /// Create a new polynomial.
    pub const fn new(x: Array<Elem<F>, U256>) -> Self {
        Self(x)
    }
}

#[cfg(feature = "zeroize")]
impl<F: Field> Zeroize for Polynomial<F>
where
    F::Int: Zeroize,
{
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl<F: Field> Add<&Polynomial<F>> for &Polynomial<F> {
    type Output = Polynomial<F>;

    fn add(self, rhs: &Polynomial<F>) -> Polynomial<F> {
        Polynomial(
            self.0
                .iter()
                .zip(rhs.0.iter())
                .map(|(&x, &y)| x + y)
                .collect(),
        )
    }
}

impl<F: Field> Sub<&Polynomial<F>> for &Polynomial<F> {
    type Output = Polynomial<F>;

    fn sub(self, rhs: &Polynomial<F>) -> Polynomial<F> {
        Polynomial(
            self.0
                .iter()
                .zip(rhs.0.iter())
                .map(|(&x, &y)| x - y)
                .collect(),
        )
    }
}

impl<F: Field> Mul<&Polynomial<F>> for Elem<F> {
    type Output = Polynomial<F>;

    fn mul(self, rhs: &Polynomial<F>) -> Polynomial<F> {
        Polynomial(rhs.0.iter().map(|&x| self * x).collect())
    }
}

impl<F: Field> Neg for &Polynomial<F> {
    type Output = Polynomial<F>;

    fn neg(self) -> Polynomial<F> {
        Polynomial(self.0.iter().map(|&x| -x).collect())
    }
}

#[cfg(feature = "ctutils")]
impl<F: Field> CtEq for Polynomial<F>
where
    F::Int: CtEq,
{
    fn ct_eq(&self, other: &Self) -> Choice {
        self.0.ct_eq(&other.0)
    }
}

#[cfg(feature = "ctutils")]
impl<F: Field<Int: CtEq>> CtEqSlice for Polynomial<F> {}

/// A `Vector` is a vector of polynomials from `R_q` of length `K`.
///
/// Vectors can be added, subtracted, negated, and multiplied by field elements.
#[derive(Clone, Default, Debug, PartialEq)]
pub struct Vector<F: Field, K: ArraySize>(pub Array<Polynomial<F>, K>);

impl<F: Field, K: ArraySize> Vector<F, K> {
    /// Create a new vector.
    pub const fn new(x: Array<Polynomial<F>, K>) -> Self {
        Self(x)
    }
}

#[cfg(feature = "zeroize")]
impl<F: Field, K: ArraySize> Zeroize for Vector<F, K>
where
    F::Int: Zeroize,
{
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl<F: Field, K: ArraySize> Add<Vector<F, K>> for Vector<F, K> {
    type Output = Vector<F, K>;
    fn add(self, rhs: Vector<F, K>) -> Vector<F, K> {
        Add::add(&self, &rhs)
    }
}
impl<F: Field, K: ArraySize> Add<&Vector<F, K>> for &Vector<F, K> {
    type Output = Vector<F, K>;

    fn add(self, rhs: &Vector<F, K>) -> Vector<F, K> {
        Vector(
            self.0
                .iter()
                .zip(rhs.0.iter())
                .map(|(x, y)| x + y)
                .collect(),
        )
    }
}

impl<F: Field, K: ArraySize> Sub<&Vector<F, K>> for &Vector<F, K> {
    type Output = Vector<F, K>;

    fn sub(self, rhs: &Vector<F, K>) -> Vector<F, K> {
        Vector(
            self.0
                .iter()
                .zip(rhs.0.iter())
                .map(|(x, y)| x - y)
                .collect(),
        )
    }
}

impl<F: Field, K: ArraySize> Mul<&Vector<F, K>> for Elem<F> {
    type Output = Vector<F, K>;

    fn mul(self, rhs: &Vector<F, K>) -> Vector<F, K> {
        Vector(rhs.0.iter().map(|x| self * x).collect())
    }
}

impl<F: Field, K: ArraySize> Neg for &Vector<F, K> {
    type Output = Vector<F, K>;

    fn neg(self) -> Vector<F, K> {
        Vector(self.0.iter().map(|x| -x).collect())
    }
}

#[cfg(feature = "ctutils")]
impl<F: Field, K: ArraySize> CtEq for Vector<F, K>
where
    F::Int: CtEq,
{
    fn ct_eq(&self, other: &Self) -> Choice {
        self.0.ct_eq(&other.0)
    }
}

#[cfg(feature = "ctutils")]
impl<F: Field<Int: CtEq>, K: ArraySize> CtEqSlice for Vector<F, K> {}

/// An `NttPolynomial` is a member of the NTT algebra `T_q = Z_q[X]^256` of 256-tuples of field
/// elements.
///
/// NTT polynomials can be added and subtracted, negated, and multiplied by scalars.
/// We do not define multiplication of NTT polynomials here: that is defined by the downstream
/// crate using the [`MultiplyNtt`] trait.
///
/// We also do not define the mappings between normal polynomials and NTT polynomials (i.e., between
/// `R_q` and `T_q`).
#[derive(Clone, Default, Debug, Eq, PartialEq)]
pub struct NttPolynomial<F: Field>(pub Array<Elem<F>, U256>);

impl<F: Field> NttPolynomial<F> {
    /// Create a new NTT polynomial.
    pub const fn new(x: Array<Elem<F>, U256>) -> Self {
        Self(x)
    }
}

impl<F: Field> Add<&NttPolynomial<F>> for &NttPolynomial<F> {
    type Output = NttPolynomial<F>;

    fn add(self, rhs: &NttPolynomial<F>) -> NttPolynomial<F> {
        NttPolynomial(
            self.0
                .iter()
                .zip(rhs.0.iter())
                .map(|(&x, &y)| x + y)
                .collect(),
        )
    }
}

impl<F: Field> Sub<&NttPolynomial<F>> for &NttPolynomial<F> {
    type Output = NttPolynomial<F>;

    fn sub(self, rhs: &NttPolynomial<F>) -> NttPolynomial<F> {
        NttPolynomial(
            self.0
                .iter()
                .zip(rhs.0.iter())
                .map(|(&x, &y)| x - y)
                .collect(),
        )
    }
}

impl<F: Field> Mul<&NttPolynomial<F>> for Elem<F> {
    type Output = NttPolynomial<F>;

    fn mul(self, rhs: &NttPolynomial<F>) -> NttPolynomial<F> {
        NttPolynomial(rhs.0.iter().map(|&x| self * x).collect())
    }
}

impl<F> Mul<&NttPolynomial<F>> for &NttPolynomial<F>
where
    F: Field + MultiplyNtt,
{
    type Output = NttPolynomial<F>;

    fn mul(self, rhs: &NttPolynomial<F>) -> NttPolynomial<F> {
        F::multiply_ntt(self, rhs)
    }
}

/// Perform multiplication in the NTT domain.
pub trait MultiplyNtt: Field {
    /// Multiply two NTT polynomials.
    fn multiply_ntt(lhs: &NttPolynomial<Self>, rhs: &NttPolynomial<Self>) -> NttPolynomial<Self>;
}

impl<F: Field> Neg for &NttPolynomial<F> {
    type Output = NttPolynomial<F>;

    fn neg(self) -> NttPolynomial<F> {
        NttPolynomial(self.0.iter().map(|&x| -x).collect())
    }
}

impl<F: Field> From<Array<Elem<F>, U256>> for NttPolynomial<F> {
    fn from(f: Array<Elem<F>, U256>) -> NttPolynomial<F> {
        NttPolynomial(f)
    }
}

impl<F: Field> From<NttPolynomial<F>> for Array<Elem<F>, U256> {
    fn from(f_hat: NttPolynomial<F>) -> Array<Elem<F>, U256> {
        f_hat.0
    }
}

#[cfg(feature = "ctutils")]
impl<F: Field> CtEq for NttPolynomial<F>
where
    F::Int: CtEq,
{
    fn ct_eq(&self, other: &Self) -> Choice {
        self.0.ct_eq(&other.0)
    }
}

#[cfg(feature = "ctutils")]
impl<F: Field<Int: CtEq>> CtEqSlice for NttPolynomial<F> {}

#[cfg(feature = "zeroize")]
impl<F: Field> Zeroize for NttPolynomial<F>
where
    F::Int: Zeroize,
{
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

/// An [`NttVector`] is a vector of polynomials from `T_q` of length `K`.
///
/// NTT vectors can be added and subtracted.  If multiplication is defined for NTT polynomials, then
/// NTT vectors can be multiplied by NTT polynomials, and "multiplied" with each other to produce a
/// dot product.
#[derive(Clone, Default, Debug, Eq, PartialEq)]
pub struct NttVector<F: Field, K: ArraySize>(pub Array<NttPolynomial<F>, K>);

impl<F: Field, K: ArraySize> NttVector<F, K> {
    /// Create a new NTT vector.
    pub const fn new(x: Array<NttPolynomial<F>, K>) -> Self {
        Self(x)
    }
}

#[cfg(feature = "ctutils")]
impl<F: Field, K: ArraySize> CtEq for NttVector<F, K>
where
    F::Int: CtEq,
{
    fn ct_eq(&self, other: &Self) -> Choice {
        self.0.ct_eq(&other.0)
    }
}

#[cfg(feature = "ctutils")]
impl<F: Field<Int: CtEq>, K: ArraySize> CtEqSlice for NttVector<F, K> {}

#[cfg(feature = "zeroize")]
impl<F: Field, K: ArraySize> Zeroize for NttVector<F, K>
where
    F::Int: Zeroize,
{
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl<F: Field, K: ArraySize> Add<&NttVector<F, K>> for &NttVector<F, K> {
    type Output = NttVector<F, K>;

    fn add(self, rhs: &NttVector<F, K>) -> NttVector<F, K> {
        NttVector(
            self.0
                .iter()
                .zip(rhs.0.iter())
                .map(|(x, y)| x + y)
                .collect(),
        )
    }
}

impl<F: Field, K: ArraySize> Sub<&NttVector<F, K>> for &NttVector<F, K> {
    type Output = NttVector<F, K>;

    fn sub(self, rhs: &NttVector<F, K>) -> NttVector<F, K> {
        NttVector(
            self.0
                .iter()
                .zip(rhs.0.iter())
                .map(|(x, y)| x - y)
                .collect(),
        )
    }
}

impl<F: Field, K: ArraySize> Mul<&NttVector<F, K>> for &NttPolynomial<F>
where
    for<'a> &'a NttPolynomial<F>: Mul<&'a NttPolynomial<F>, Output = NttPolynomial<F>>,
{
    type Output = NttVector<F, K>;

    fn mul(self, rhs: &NttVector<F, K>) -> NttVector<F, K> {
        NttVector(rhs.0.iter().map(|x| self * x).collect())
    }
}

impl<F: Field, K: ArraySize> Mul<&NttVector<F, K>> for &NttVector<F, K>
where
    for<'a> &'a NttPolynomial<F>: Mul<&'a NttPolynomial<F>, Output = NttPolynomial<F>>,
{
    type Output = NttPolynomial<F>;

    fn mul(self, rhs: &NttVector<F, K>) -> NttPolynomial<F> {
        self.0
            .iter()
            .zip(rhs.0.iter())
            .map(|(x, y)| x * y)
            .fold(NttPolynomial::default(), |x, y| &x + &y)
    }
}

/// A `K x L` matrix of NTT-domain polynomials.
///
/// Each vector represents a row of the matrix, so that multiplying on the right just requires
/// iteration.
///
/// Multiplication on the right by vectors is the only defined operation, and is only defined when
/// multiplication of NTT polynomials is defined.
#[derive(Clone, Default, Debug, PartialEq)]
pub struct NttMatrix<F: Field, K: ArraySize, L: ArraySize>(pub Array<NttVector<F, L>, K>);

impl<F: Field, K: ArraySize, L: ArraySize> NttMatrix<F, K, L> {
    /// Create a new NTT matrix.
    pub const fn new(x: Array<NttVector<F, L>, K>) -> Self {
        Self(x)
    }
}

impl<F: Field, K: ArraySize, L: ArraySize> Mul<&NttVector<F, L>> for &NttMatrix<F, K, L>
where
    for<'a> &'a NttPolynomial<F>: Mul<&'a NttPolynomial<F>, Output = NttPolynomial<F>>,
{
    type Output = NttVector<F, K>;

    fn mul(self, rhs: &NttVector<F, L>) -> NttVector<F, K> {
        NttVector(self.0.iter().map(|x| x * rhs).collect())
    }
}

#[cfg(feature = "ctutils")]
impl<F: Field, K: ArraySize, L: ArraySize> CtEq for NttMatrix<F, K, L>
where
    F::Int: CtEq,
{
    fn ct_eq(&self, other: &Self) -> Choice {
        self.0.ct_eq(&other.0)
    }
}

#[cfg(feature = "ctutils")]
impl<F: Field<Int: CtEq>, K: ArraySize, L: ArraySize> CtEqSlice for NttMatrix<F, K, L> {}
