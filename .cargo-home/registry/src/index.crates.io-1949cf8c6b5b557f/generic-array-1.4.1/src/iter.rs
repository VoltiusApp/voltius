//! `GenericArray` iterator implementation.

use super::{ArrayLength, GenericArray};
use core::iter::FusedIterator;
use core::mem::ManuallyDrop;
use core::{cmp, fmt, mem, ptr};

/// An iterator that moves out of a [`GenericArray`]
pub struct GenericArrayIter<T, N: ArrayLength> {
    // Invariants: index <= index_back <= N
    // Only values in array[index..index_back] are alive at any given time.
    // Values from array[..index] and array[index_back..] are already moved/dropped.
    array: ManuallyDrop<GenericArray<T, N>>,
    index: usize,
    index_back: usize,
}

impl<T, N: ArrayLength> GenericArrayIter<T, N> {
    /// Returns the remaining items of this iterator as a slice
    #[inline(always)]
    pub fn as_slice(&self) -> &[T] {
        // SAFETY: index and index_back are guaranteed to be within bounds
        unsafe { self.array.get_unchecked(self.index..self.index_back) }
    }

    /// Returns the remaining items of this iterator as a mutable slice
    #[inline(always)]
    pub fn as_mut_slice(&mut self) -> &mut [T] {
        // SAFETY: index and index_back are guaranteed to be within bounds
        unsafe { self.array.get_unchecked_mut(self.index..self.index_back) }
    }
}

impl<T, N: ArrayLength> IntoIterator for GenericArray<T, N> {
    type Item = T;
    type IntoIter = GenericArrayIter<T, N>;

    #[inline]
    fn into_iter(self) -> Self::IntoIter {
        GenericArrayIter {
            array: ManuallyDrop::new(self),
            index: 0,
            index_back: N::USIZE,
        }
    }
}

// Based on work in rust-lang/rust#49000
impl<T: fmt::Debug, N: ArrayLength> fmt::Debug for GenericArrayIter<T, N> {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.debug_tuple("GenericArrayIter")
            .field(&self.as_slice())
            .finish()
    }
}

impl<T, N: ArrayLength> Drop for GenericArrayIter<T, N> {
    fn drop(&mut self) {
        unsafe {
            ptr::drop_in_place(self.as_mut_slice());
        }
    }
}

// Based on work in rust-lang/rust#49000
impl<T: Clone, N: ArrayLength> Clone for GenericArrayIter<T, N> {
    fn clone(&self) -> Self {
        // This places all cloned elements at the start of the new array iterator,
        // not at their original indices.

        // work from within the iter so if clone panics then the iter will drop itself.
        let mut iter = GenericArrayIter {
            array: unsafe { ptr::read(&self.array) },
            index: 0,
            index_back: 0,
        };

        for (dst, src) in iter.array.as_mut_slice().iter_mut().zip(self.as_slice()) {
            unsafe { ptr::write(dst, src.clone()) };
            iter.index_back += 1;
        }

        iter
    }
}

impl<T, N: ArrayLength> Iterator for GenericArrayIter<T, N> {
    type Item = T;

    #[inline]
    fn next(&mut self) -> Option<T> {
        if self.index < self.index_back {
            let p = unsafe { Some(ptr::read(self.array.get_unchecked(self.index))) };

            self.index += 1;

            p
        } else {
            None
        }
    }

    #[inline]
    fn fold<B, F>(mut self, init: B, mut f: F) -> B
    where
        F: FnMut(B, Self::Item) -> B,
    {
        let ret = unsafe {
            let GenericArrayIter {
                ref array,
                ref mut index,
                index_back,
            } = self;

            let remaining = array.get_unchecked(*index..index_back);

            remaining.iter().fold(init, |acc, src| {
                let value = ptr::read(src);

                *index += 1;

                f(acc, value)
            })
        };

        // The current iterator is now empty after the remaining items are
        // consumed by the above folding. Dropping it is unnecessary,
        // so avoid the drop codegen and forget it instead. The iterator
        // will still drop on panics from `f`, of course.
        //
        // Furthermore, putting `forget` here at the end ensures the above
        // destructuring never moves by value, so its behavior on drop remains intact.
        mem::forget(self);

        ret
    }

    #[inline(always)]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let len = self.len();
        (len, Some(len))
    }

    #[inline(always)]
    fn count(self) -> usize {
        self.len()
    }

    fn nth(&mut self, n: usize) -> Option<T> {
        // First consume values prior to the nth.
        let next_index = self.index + cmp::min(n, self.len());

        unsafe {
            ptr::drop_in_place(self.array.get_unchecked_mut(self.index..next_index));
        }

        self.index = next_index;

        self.next()
    }

    #[inline]
    fn last(mut self) -> Option<T> {
        // Note, everything else will correctly drop first as `self` leaves scope.
        self.next_back()
    }
}

impl<T, N: ArrayLength> DoubleEndedIterator for GenericArrayIter<T, N> {
    #[inline]
    fn next_back(&mut self) -> Option<T> {
        if self.index < self.index_back {
            self.index_back -= 1;

            unsafe { Some(ptr::read(self.array.get_unchecked(self.index_back))) }
        } else {
            None
        }
    }

    #[inline]
    fn rfold<B, F>(mut self, init: B, mut f: F) -> B
    where
        F: FnMut(B, Self::Item) -> B,
    {
        let ret = unsafe {
            let GenericArrayIter {
                ref array,
                index,
                ref mut index_back,
            } = self;

            let remaining = array.get_unchecked(index..*index_back);

            remaining.iter().rfold(init, |acc, src| {
                let value = ptr::read(src);

                *index_back -= 1;

                f(acc, value)
            })
        };

        // Same as `fold`
        mem::forget(self);

        ret
    }

    fn nth_back(&mut self, n: usize) -> Option<T> {
        let next_back = self.index_back - cmp::min(n, self.len());

        unsafe {
            ptr::drop_in_place(self.array.get_unchecked_mut(next_back..self.index_back));
        }

        self.index_back = next_back;

        self.next_back()
    }
}

impl<T, N: ArrayLength> ExactSizeIterator for GenericArrayIter<T, N> {
    #[inline]
    fn len(&self) -> usize {
        self.index_back - self.index
    }
}

impl<T, N: ArrayLength> FusedIterator for GenericArrayIter<T, N> {}

// TODO: Implement `TrustedLen` when stabilized

#[cfg(test)]
mod test {
    use super::*;

    fn send<I: Send>(_iter: I) {}

    #[test]
    fn test_send_iter() {
        send(GenericArray::from([1, 2, 3, 4]).into_iter());
    }
}
