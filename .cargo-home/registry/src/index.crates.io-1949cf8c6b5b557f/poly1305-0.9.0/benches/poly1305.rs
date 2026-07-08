//! Poly1305 benchmarks.

#![feature(test)]

extern crate test;

use poly1305::{
    Poly1305,
    universal_hash::{KeyInit, UniversalHash},
};
use test::Bencher;

// TODO(tarcieri): move this into the `universal-hash` crate
macro_rules! bench {
    ($name:ident, $bs:expr) => {
        #[bench]
        fn $name(b: &mut Bencher) {
            let key = Default::default();
            let mut m = Poly1305::new(&key);
            let data = [0; $bs];

            b.iter(|| {
                m.update_padded(&data);
            });

            b.bytes = $bs;
        }
    };
}

bench!(bench_poly1305_1_10, 10);
bench!(bench_poly1305_2_100, 100);
bench!(bench_poly1305_3_1000, 1000);
bench!(bench_poly1305_4_10000, 10000);
