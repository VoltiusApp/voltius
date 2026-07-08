#![feature(test)]

extern crate test;

use ghash::{GHash, universal_hash::UniversalHash};
use test::Bencher;

// TODO(tarcieri): move this into the `universal-hash` crate
macro_rules! bench {
    ($name:ident, $bs:expr) => {
        #[bench]
        fn $name(b: &mut Bencher) {
            let key = Default::default();
            let mut m = GHash::new(&key);
            let data = [0; $bs];

            b.iter(|| {
                m.update_padded(&data);
            });

            b.bytes = $bs;
        }
    };
}

bench!(bench_ghash_1_10, 10);
bench!(bench_ghash_2_100, 100);
bench!(bench_ghash_3_1000, 1000);
bench!(bench_ghash_3_10000, 10000);
