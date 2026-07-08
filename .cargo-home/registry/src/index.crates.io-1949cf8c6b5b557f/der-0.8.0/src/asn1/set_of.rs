//! ASN.1 `SET OF` support.
//!
//! # Ordering Notes
//!
//! Some DER serializer implementations fail to properly sort elements of a `SET OF`. This is
//! technically non-canonical, but occurs frequently enough that most DER decoders tolerate it.
//!
//! When decoding with `EncodingRules::Der`, this implementation sorts the elements of `SET OF` at
//! decode-time to ensure reserializations are canonical.

#![cfg(any(feature = "alloc", feature = "heapless"))]

use crate::{
    Decode, DecodeValue, DerOrd, Encode, EncodeValue, Error, ErrorKind, FixedTag, Header, Length,
    Reader, Tag, ValueOrd, Writer, ord::iter_cmp,
};
use core::cmp::Ordering;

#[cfg(feature = "alloc")]
use alloc::vec::Vec;
#[cfg(any(feature = "alloc", feature = "heapless"))]
use core::slice;

/// ASN.1 `SET OF` backed by an array.
///
/// This type implements an append-only `SET OF` type which is stack-based
/// and does not depend on `alloc` support.
// TODO(tarcieri): use `ArrayVec` when/if it's merged into `core` (rust-lang/rfcs#3316)
#[cfg(feature = "heapless")]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord, Hash)]
pub struct SetOf<T, const N: usize>
where
    T: DerOrd,
{
    inner: heapless::Vec<T, N>,
}

#[cfg(feature = "heapless")]
impl<T, const N: usize> SetOf<T, N>
where
    T: DerOrd,
{
    /// Create a new [`SetOf`].
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: heapless::Vec::default(),
        }
    }

    /// Insert an item into this [`SetOf`].
    ///
    /// # Errors
    /// If there's a duplicate or sorting error.
    pub fn insert(&mut self, item: T) -> Result<(), Error> {
        check_duplicate(&item, self.iter())?;
        self.try_push(item)?;
        der_sort(self.inner.as_mut())
    }

    /// Insert an item into this [`SetOf`].
    ///
    /// Items MUST be added in lexicographical order according to the [`DerOrd`] impl on `T`.
    ///
    /// # Errors
    /// If items are added out-of-order or there isn't sufficient space.
    pub fn insert_ordered(&mut self, item: T) -> Result<(), Error> {
        // Ensure set elements are lexicographically ordered
        if let Some(last) = self.inner.last() {
            check_der_ordering(last, &item)?;
        }

        self.try_push(item)
    }

    /// Borrow the elements of this [`SetOf`] as a slice.
    pub fn as_slice(&self) -> &[T] {
        self.inner.as_slice()
    }

    /// Get the nth element from this [`SetOf`].
    pub fn get(&self, index: usize) -> Option<&T> {
        self.inner.get(index)
    }

    /// Extract the inner `heapless::Vec`.
    pub fn into_inner(self) -> heapless::Vec<T, N> {
        self.inner
    }

    /// Iterate over the elements of this [`SetOf`].
    pub fn iter(&self) -> SetOfIter<'_, T> {
        SetOfIter {
            inner: self.inner.iter(),
        }
    }

    /// Is this [`SetOf`] empty?
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Number of elements in this [`SetOf`].
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// Attempt to push an element onto the [`SetOf`].
    ///
    /// Does not perform ordering or uniqueness checks.
    fn try_push(&mut self, item: T) -> Result<(), Error> {
        self.inner
            .push(item)
            .map_err(|_| ErrorKind::Overlength.into())
    }
}

#[cfg(feature = "heapless")]
impl<T, const N: usize> AsRef<[T]> for SetOf<T, N>
where
    T: DerOrd,
{
    fn as_ref(&self) -> &[T] {
        self.as_slice()
    }
}

#[cfg(feature = "heapless")]
impl<T, const N: usize> Default for SetOf<T, N>
where
    T: DerOrd,
{
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(feature = "heapless")]
impl<'a, T, const N: usize> DecodeValue<'a> for SetOf<T, N>
where
    T: Decode<'a> + DerOrd,
{
    type Error = T::Error;

    fn decode_value<R: Reader<'a>>(reader: &mut R, _header: Header) -> Result<Self, Self::Error> {
        let mut result = Self::new();

        while !reader.is_finished() {
            result.try_push(T::decode(reader)?)?;
        }

        if reader.encoding_rules().is_der() {
            // Ensure elements of the `SetOf` are sorted and will serialize as valid DER
            der_sort(result.inner.as_mut())?;
        }

        Ok(result)
    }
}

#[cfg(feature = "heapless")]
impl<T, const N: usize> EncodeValue for SetOf<T, N>
where
    T: Encode + DerOrd,
{
    fn value_len(&self) -> Result<Length, Error> {
        self.iter()
            .try_fold(Length::ZERO, |len, elem| len + elem.encoded_len()?)
    }

    fn encode_value(&self, writer: &mut impl Writer) -> Result<(), Error> {
        for elem in self.iter() {
            elem.encode(writer)?;
        }

        Ok(())
    }
}

#[cfg(feature = "heapless")]
impl<T, const N: usize> FixedTag for SetOf<T, N>
where
    T: DerOrd,
{
    const TAG: Tag = Tag::Set;
}

#[cfg(feature = "heapless")]
impl<T, const N: usize> TryFrom<[T; N]> for SetOf<T, N>
where
    T: DerOrd,
{
    type Error = Error;

    fn try_from(mut arr: [T; N]) -> Result<SetOf<T, N>, Error> {
        der_sort(&mut arr)?;

        let mut result = SetOf::new();

        for elem in arr {
            result.insert_ordered(elem)?;
        }

        Ok(result)
    }
}

#[cfg(feature = "heapless")]
impl<T, const N: usize> ValueOrd for SetOf<T, N>
where
    T: DerOrd,
{
    fn value_cmp(&self, other: &Self) -> Result<Ordering, Error> {
        iter_cmp(self.iter(), other.iter())
    }
}

/// Iterator over the elements of an [`SetOf`].
#[derive(Clone, Debug)]
pub struct SetOfIter<'a, T> {
    /// Inner iterator.
    inner: slice::Iter<'a, T>,
}

impl<'a, T: 'a> Iterator for SetOfIter<'a, T> {
    type Item = &'a T;

    fn next(&mut self) -> Option<&'a T> {
        self.inner.next()
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

impl<'a, T: 'a> ExactSizeIterator for SetOfIter<'a, T> {}

/// ASN.1 `SET OF` backed by a [`Vec`].
///
/// This type implements an append-only `SET OF` type which is heap-backed
/// and depends on `alloc` support.
#[cfg(feature = "alloc")]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord, Hash)]
pub struct SetOfVec<T>
where
    T: DerOrd,
{
    inner: Vec<T>,
}

#[cfg(feature = "alloc")]
impl<T: DerOrd> Default for SetOfVec<T> {
    fn default() -> Self {
        Self {
            inner: Default::default(),
        }
    }
}

#[cfg(feature = "alloc")]
impl<T> SetOfVec<T>
where
    T: DerOrd,
{
    /// Create a new [`SetOfVec`].
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: Vec::default(),
        }
    }

    /// Create a new [`SetOfVec`] from the given iterator.
    ///
    /// Note: this is an inherent method instead of an impl of the [`FromIterator`] trait in order
    /// to be fallible.
    ///
    /// # Errors
    /// If a sorting error occurred.
    #[allow(clippy::should_implement_trait)]
    pub fn from_iter<I>(iter: I) -> Result<Self, Error>
    where
        I: IntoIterator<Item = T>,
    {
        Vec::from_iter(iter).try_into()
    }

    /// Extend a [`SetOfVec`] using an iterator.
    ///
    /// Note: this is an inherent method instead of an impl of the [`Extend`] trait in order to
    /// be fallible.
    ///
    /// # Errors
    /// If a sorting error occurred.
    pub fn extend<I>(&mut self, iter: I) -> Result<(), Error>
    where
        I: IntoIterator<Item = T>,
    {
        self.inner.extend(iter);
        der_sort(&mut self.inner)
    }

    /// Insert an item into this [`SetOfVec`]. Must be unique.
    ///
    /// # Errors
    /// If `item` is a duplicate or a sorting error occurred.
    pub fn insert(&mut self, item: T) -> Result<(), Error> {
        check_duplicate(&item, self.iter())?;
        self.inner.push(item);
        der_sort(&mut self.inner)
    }

    /// Insert an item into this [`SetOfVec`]. Must be unique.
    ///
    /// Items MUST be added in lexicographical order according to the [`DerOrd`] impl on `T`.
    ///
    /// # Errors
    /// If a sorting error occurred.
    pub fn insert_ordered(&mut self, item: T) -> Result<(), Error> {
        // Ensure set elements are lexicographically ordered
        if let Some(last) = self.inner.last() {
            check_der_ordering(last, &item)?;
        }

        self.inner.push(item);
        Ok(())
    }

    /// Borrow the elements of this [`SetOfVec`] as a slice.
    #[must_use]
    pub fn as_slice(&self) -> &[T] {
        self.inner.as_slice()
    }

    /// Get the nth element from this [`SetOfVec`].
    #[must_use]
    pub fn get(&self, index: usize) -> Option<&T> {
        self.inner.get(index)
    }

    /// Convert this [`SetOfVec`] into the inner [`Vec`].
    #[must_use]
    pub fn into_vec(self) -> Vec<T> {
        self.inner
    }

    /// Iterate over the elements of this [`SetOfVec`].
    #[must_use]
    pub fn iter(&self) -> SetOfIter<'_, T> {
        SetOfIter {
            inner: self.inner.iter(),
        }
    }

    /// Is this [`SetOfVec`] empty?
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Number of elements in this [`SetOfVec`].
    #[must_use]
    pub fn len(&self) -> usize {
        self.inner.len()
    }
}

#[cfg(feature = "alloc")]
impl<T> AsRef<[T]> for SetOfVec<T>
where
    T: DerOrd,
{
    fn as_ref(&self) -> &[T] {
        self.as_slice()
    }
}

#[cfg(feature = "alloc")]
impl<'a, T> DecodeValue<'a> for SetOfVec<T>
where
    T: Decode<'a> + DerOrd,
{
    type Error = T::Error;

    fn decode_value<R: Reader<'a>>(reader: &mut R, _header: Header) -> Result<Self, Self::Error> {
        let mut inner = Vec::new();

        while !reader.is_finished() {
            inner.push(T::decode(reader)?);
        }

        if reader.encoding_rules().is_der() {
            der_sort(inner.as_mut())?;
        }

        Ok(Self { inner })
    }
}

#[cfg(feature = "alloc")]
impl<T> EncodeValue for SetOfVec<T>
where
    T: Encode + DerOrd,
{
    fn value_len(&self) -> Result<Length, Error> {
        self.iter()
            .try_fold(Length::ZERO, |len, elem| len + elem.encoded_len()?)
    }

    fn encode_value(&self, writer: &mut impl Writer) -> Result<(), Error> {
        for elem in self.iter() {
            elem.encode(writer)?;
        }

        Ok(())
    }
}

#[cfg(feature = "alloc")]
impl<T> FixedTag for SetOfVec<T>
where
    T: DerOrd,
{
    const TAG: Tag = Tag::Set;
}

#[cfg(feature = "alloc")]
impl<T> From<SetOfVec<T>> for Vec<T>
where
    T: DerOrd,
{
    fn from(set: SetOfVec<T>) -> Vec<T> {
        set.into_vec()
    }
}

#[cfg(feature = "alloc")]
impl<T> TryFrom<Vec<T>> for SetOfVec<T>
where
    T: DerOrd,
{
    type Error = Error;

    fn try_from(mut vec: Vec<T>) -> Result<SetOfVec<T>, Error> {
        // TODO(tarcieri): use `[T]::sort_by` here?
        der_sort(vec.as_mut_slice())?;
        Ok(SetOfVec { inner: vec })
    }
}

#[cfg(feature = "alloc")]
impl<T, const N: usize> TryFrom<[T; N]> for SetOfVec<T>
where
    T: DerOrd,
{
    type Error = Error;

    fn try_from(arr: [T; N]) -> Result<SetOfVec<T>, Error> {
        Vec::from(arr).try_into()
    }
}

#[cfg(feature = "alloc")]
impl<T> ValueOrd for SetOfVec<T>
where
    T: DerOrd,
{
    fn value_cmp(&self, other: &Self) -> Result<Ordering, Error> {
        iter_cmp(self.iter(), other.iter())
    }
}

// Implement by hand because custom derive would create invalid values.
// Use the conversion from Vec to create a valid value.
#[cfg(feature = "arbitrary")]
impl<'a, T> arbitrary::Arbitrary<'a> for SetOfVec<T>
where
    T: DerOrd + arbitrary::Arbitrary<'a>,
{
    fn arbitrary(u: &mut arbitrary::Unstructured<'a>) -> arbitrary::Result<Self> {
        Self::try_from(u.arbitrary_iter()?.collect::<Result<Vec<_>, _>>()?)
            .map_err(|_| arbitrary::Error::IncorrectFormat)
    }

    fn size_hint(_depth: usize) -> (usize, Option<usize>) {
        (0, None)
    }
}

/// Check if the given item is a duplicate, given an iterator over sorted items (which we can
/// short-circuit once we hit `Ordering::Less`.
fn check_duplicate<'a, T, I>(item: &T, iter: I) -> Result<(), Error>
where
    T: DerOrd + 'a,
    I: Iterator<Item = &'a T>,
{
    for item2 in iter {
        match item.der_cmp(item2)? {
            Ordering::Less => return Ok(()), // all remaining items are greater
            Ordering::Equal => return Err(ErrorKind::SetDuplicate.into()),
            Ordering::Greater => continue,
        }
    }

    Ok(())
}

/// Ensure set elements are lexicographically ordered using [`DerOrd`].
fn check_der_ordering<T: DerOrd>(a: &T, b: &T) -> Result<(), Error> {
    match a.der_cmp(b)? {
        Ordering::Less => Ok(()),
        Ordering::Equal => Err(ErrorKind::SetDuplicate.into()),
        Ordering::Greater => Err(ErrorKind::SetOrdering.into()),
    }
}

/// Sort a mut slice according to its [`DerOrd`], returning any errors which
/// might occur during the comparison.
///
/// The algorithm is insertion sort, which should perform well when the input
/// is mostly sorted to begin with.
///
/// This function is used rather than Rust's built-in `[T]::sort_by` in order
/// to support heapless `no_std` targets as well as to enable bubbling up
/// sorting errors.
#[allow(clippy::arithmetic_side_effects)]
fn der_sort<T: DerOrd>(slice: &mut [T]) -> Result<(), Error> {
    for i in 0..slice.len() {
        let mut j = i;

        while j > 0 {
            match slice[j - 1].der_cmp(&slice[j])? {
                Ordering::Less => break,
                Ordering::Equal => return Err(ErrorKind::SetDuplicate.into()),
                Ordering::Greater => {
                    slice.swap(j - 1, j);
                    j -= 1;
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    #[cfg(feature = "alloc")]
    use super::SetOfVec;
    use crate::ErrorKind;
    #[cfg(feature = "heapless")]
    use {super::SetOf, crate::DerOrd};

    #[cfg(feature = "heapless")]
    #[test]
    fn setof_insert() {
        let mut setof = SetOf::<u8, 10>::new();
        setof.insert(42).unwrap();
        assert_eq!(setof.len(), 1);
        assert_eq!(*setof.iter().next().unwrap(), 42);

        // Ensure duplicates are disallowed
        assert_eq!(
            setof.insert(42).unwrap_err().kind(),
            ErrorKind::SetDuplicate
        );
        assert_eq!(setof.len(), 1);
    }

    #[cfg(feature = "heapless")]
    #[test]
    fn setof_tryfrom_array() {
        let arr = [3u16, 2, 1, 65535, 0];
        let set = SetOf::try_from(arr).unwrap();
        assert!(set.iter().copied().eq([0, 1, 2, 3, 65535]));
    }

    #[cfg(feature = "heapless")]
    #[test]
    fn setof_tryfrom_array_reject_duplicates() {
        let arr = [1u16, 1];
        let err = SetOf::try_from(arr).err().unwrap();
        assert_eq!(err.kind(), ErrorKind::SetDuplicate);
    }

    #[cfg(feature = "heapless")]
    #[test]
    fn setof_valueord_value_cmp() {
        use core::cmp::Ordering;

        let arr1 = [3u16, 2, 1, 5, 0];
        let arr2 = [3u16, 2, 1, 4, 0];
        let set1 = SetOf::try_from(arr1).unwrap();
        let set2 = SetOf::try_from(arr2).unwrap();
        assert_eq!(set1.der_cmp(&set2), Ok(Ordering::Greater));
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn setofvec_insert() {
        let mut setof = SetOfVec::new();
        setof.insert(42).unwrap();
        assert_eq!(setof.len(), 1);
        assert_eq!(*setof.iter().next().unwrap(), 42);

        // Ensure duplicates are disallowed
        assert_eq!(
            setof.insert(42).unwrap_err().kind(),
            ErrorKind::SetDuplicate
        );
        assert_eq!(setof.len(), 1);
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn setofvec_tryfrom_array() {
        let arr = [3u16, 2, 1, 65535, 0];
        let set = SetOfVec::try_from(arr).unwrap();
        assert_eq!(set.as_ref(), &[0, 1, 2, 3, 65535]);
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn setofvec_tryfrom_vec() {
        let vec = vec![3u16, 2, 1, 65535, 0];
        let set = SetOfVec::try_from(vec).unwrap();
        assert_eq!(set.as_ref(), &[0, 1, 2, 3, 65535]);
    }

    #[cfg(feature = "alloc")]
    #[test]
    fn setofvec_tryfrom_vec_reject_duplicates() {
        let vec = vec![1u16, 1];
        let err = SetOfVec::try_from(vec).err().unwrap();
        assert_eq!(err.kind(), ErrorKind::SetDuplicate);
    }
}
