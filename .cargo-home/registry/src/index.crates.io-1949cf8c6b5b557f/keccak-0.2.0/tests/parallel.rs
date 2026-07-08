//! Tests for the `parallel` crate feature
#![cfg(feature = "parallel")]
use core::array;
use hybrid_array::Array;
use keccak::{Backend, BackendClosure, State1600};

const N: usize = 50;

/// Test that we get the same result for scalar and parallel functions.
fn test_fn<B: Backend>() {
    let f1600 = B::get_f1600();
    let par_f1600 = B::get_par_f1600();

    let mut buf: [State1600; N] = array::from_fn(|i| array::from_fn(|_| i as u64));
    let expected: [State1600; N] = buf.map(|mut s| {
        f1600(&mut s);
        s
    });

    let (chunks, tail) = Array::slice_as_chunks_mut(&mut buf[..]);

    chunks.iter_mut().for_each(par_f1600);
    tail.iter_mut().for_each(f1600);

    assert_eq!(buf, expected);
}

#[test]
fn keccak_par_f1600() {
    struct Closure;

    impl BackendClosure for Closure {
        fn call_once<B: Backend>(self) {
            test_fn::<B>();
        }
    }

    keccak::Keccak::new().with_backend(Closure);
}
