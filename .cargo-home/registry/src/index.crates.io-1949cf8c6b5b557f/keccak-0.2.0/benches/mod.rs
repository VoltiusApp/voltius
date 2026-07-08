//! keccak benchmarks

#![feature(test)]
extern crate test;

use core::hint::black_box;
use keccak::Keccak;

macro_rules! impl_bench {
    ($name:ident, $fn:ident, $type:expr) => {
        #[bench]
        fn $name(b: &mut test::Bencher) {
            let mut data = black_box([0; 25]);
            Keccak::new().$fn(|f| b.iter(|| black_box(f(&mut data))))
        }
    };
}

impl_bench!(keccak_f200, with_f200, 0u8);
impl_bench!(keccak_f400, with_f400, 0u16);
impl_bench!(keccak_f800, with_f800, 0u32);
impl_bench!(keccak_f1600, with_f1600, 0u64);
