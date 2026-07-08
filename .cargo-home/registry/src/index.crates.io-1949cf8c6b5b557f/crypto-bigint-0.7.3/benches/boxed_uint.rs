//! `BoxedUint` benchmarks

#![allow(missing_docs)]
#![allow(clippy::integer_division_remainder_used, reason = "benchmark")]

use chacha20::ChaCha8Rng;
use core::hint::black_box;
use criterion::{BatchSize, Criterion, criterion_group, criterion_main};
use crypto_bigint::{
    BoxedUint, ConcatenatingMul, ConcatenatingSquare, Gcd, Integer, Limb, NonZero, RandomBits,
};
use num_bigint::BigUint;
use rand_core::SeedableRng;

/// Size of `BoxedUint` to use in benchmark.
const UINT_BITS: u32 = 4096;

fn bench_shifts(c: &mut Criterion) {
    let mut group = c.benchmark_group("bit shifts");
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);

    group.bench_function("shl_vartime", |b| {
        b.iter_batched(
            || BoxedUint::random_bits(&mut rng, UINT_BITS),
            |x| black_box(x.shl_vartime(UINT_BITS / 2 + 10)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("shl", |b| {
        b.iter_batched(
            || BoxedUint::random_bits(&mut rng, UINT_BITS),
            |x| black_box(x.overflowing_shl(UINT_BITS / 2 + 10)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("shr_vartime", |b| {
        b.iter_batched(
            || BoxedUint::random_bits(&mut rng, UINT_BITS),
            |x| black_box(x.shr_vartime(UINT_BITS / 2 + 10)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("shr", |b| {
        b.iter_batched(
            || BoxedUint::random_bits(&mut rng, UINT_BITS),
            |x| black_box(x.overflowing_shr(UINT_BITS / 2 + 10)),
            BatchSize::SmallInput,
        );
    });

    group.finish();
}

fn bench_mul(c: &mut Criterion) {
    let mut group = c.benchmark_group("wrapping ops");
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);

    group.bench_function("boxed_mul", |b| {
        b.iter_batched(
            || {
                (
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                )
            },
            |(x, y)| black_box(x.concatenating_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("boxed_wrapping_mul", |b| {
        b.iter_batched(
            || {
                (
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                )
            },
            |(x, y)| black_box(x.wrapping_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("boxed_checked_mul", |b| {
        b.iter_batched(
            || {
                (
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                )
            },
            |(x, y)| black_box(x.checked_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("boxed_square", |b| {
        b.iter_batched(
            || BoxedUint::random_bits(&mut rng, UINT_BITS),
            |x| black_box(x.concatenating_square()),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("boxed_wrapping_square", |b| {
        b.iter_batched(
            || BoxedUint::random_bits(&mut rng, UINT_BITS),
            |x| black_box(x.wrapping_square()),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("boxed_wrapping_pow", |b| {
        b.iter_batched(
            || {
                (
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                )
            },
            |(x, y)| black_box(x.wrapping_pow(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("boxed_wrapping_pow_vartime", |b| {
        b.iter_batched(
            || {
                (
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                )
            },
            |(x, y)| black_box(x.wrapping_pow_vartime(&y)),
            BatchSize::SmallInput,
        );
    });
}

fn bench_division(c: &mut Criterion) {
    let mut group = c.benchmark_group("wrapping ops");
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);

    group.bench_function("boxed_div_rem", |b| {
        b.iter_batched(
            || {
                (
                    BoxedUint::max(UINT_BITS),
                    NonZero::new(BoxedUint::random_bits_with_precision(
                        &mut rng,
                        UINT_BITS / 2,
                        UINT_BITS,
                    ))
                    .unwrap(),
                )
            },
            |(x, y)| black_box(x.div_rem(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("boxed_div_rem_vartime", |b| {
        b.iter_batched(
            || {
                (
                    BoxedUint::max(UINT_BITS),
                    NonZero::new(BoxedUint::random_bits_with_precision(
                        &mut rng,
                        UINT_BITS / 2,
                        UINT_BITS,
                    ))
                    .unwrap(),
                )
            },
            |(x, y)| black_box(x.div_rem_vartime(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("boxed_div_rem_limb", |b| {
        b.iter_batched(
            || (BoxedUint::max(UINT_BITS), NonZero::new(Limb::ONE).unwrap()),
            |(x, y)| black_box(x.div_rem_limb(y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("boxed_rem", |b| {
        b.iter_batched(
            || {
                (
                    BoxedUint::max(UINT_BITS),
                    NonZero::new(BoxedUint::random_bits_with_precision(
                        &mut rng,
                        UINT_BITS / 2,
                        UINT_BITS,
                    ))
                    .unwrap(),
                )
            },
            |(x, y)| black_box(x.rem(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("boxed_rem_vartime", |b| {
        b.iter_batched(
            || {
                (
                    BoxedUint::max(UINT_BITS),
                    NonZero::new(BoxedUint::random_bits_with_precision(
                        &mut rng,
                        UINT_BITS / 2,
                        UINT_BITS,
                    ))
                    .unwrap(),
                )
            },
            |(x, y)| black_box(x.rem_vartime(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("boxed_rem_limb", |b| {
        b.iter_batched(
            || (BoxedUint::max(UINT_BITS), NonZero::new(Limb::ONE).unwrap()),
            |(x, y)| black_box(x.rem_limb(y)),
            BatchSize::SmallInput,
        );
    });

    group.finish();
}

fn bench_boxed_sqrt(c: &mut Criterion) {
    let mut group = c.benchmark_group("boxed_sqrt");
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);

    group.bench_function("floor_sqrt, 4096", |b| {
        b.iter_batched(
            || BoxedUint::random_bits(&mut rng, UINT_BITS),
            |x| black_box(x.floor_sqrt()),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("floor_sqrt_vartime, 4096", |b| {
        b.iter_batched(
            || BoxedUint::random_bits(&mut rng, UINT_BITS),
            |x| black_box(x.floor_sqrt_vartime()),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("checked_sqrt, 4096", |b| {
        b.iter_batched(
            || BoxedUint::random_bits(&mut rng, UINT_BITS),
            |x| black_box(x.checked_sqrt()),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("checked_sqrt_vartime, 4096", |b| {
        b.iter_batched(
            || BoxedUint::random_bits(&mut rng, UINT_BITS),
            |x| black_box(x.checked_sqrt_vartime()),
            BatchSize::SmallInput,
        );
    });
}

fn bench_radix_encoding(c: &mut Criterion) {
    let mut group = c.benchmark_group("boxed_radix_encode");
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);

    for radix in [2, 8, 10] {
        group.bench_function(format!("from_str_radix_vartime, {radix}"), |b| {
            b.iter_batched(
                || BoxedUint::random_bits(&mut rng, UINT_BITS).to_string_radix_vartime(10),
                |x| {
                    black_box(BoxedUint::from_str_radix_with_precision_vartime(
                        &x, radix, UINT_BITS,
                    ))
                },
                BatchSize::SmallInput,
            );
        });

        group.bench_function(format!("parse_bytes, {radix} (num-bigint-dig)"), |b| {
            b.iter_batched(
                || BoxedUint::random_bits(&mut rng, UINT_BITS).to_string_radix_vartime(10),
                |x| black_box(BigUint::parse_bytes(x.as_bytes(), radix)),
                BatchSize::SmallInput,
            );
        });

        group.bench_function(format!("to_str_radix_vartime, {radix}"), |b| {
            b.iter_batched(
                || BoxedUint::random_bits(&mut rng, UINT_BITS),
                |x| black_box(x.to_string_radix_vartime(radix)),
                BatchSize::SmallInput,
            );
        });

        group.bench_function(format!("to_str_radix, {radix} (num-bigint-dig)"), |b| {
            b.iter_batched(
                || {
                    let u = BoxedUint::random_bits(&mut rng, UINT_BITS);
                    BigUint::from_bytes_be(&u.to_be_bytes())
                },
                |x| black_box(x.to_str_radix(radix)),
                BatchSize::SmallInput,
            );
        });
    }
}

fn bench_gcd(c: &mut Criterion) {
    let mut group = c.benchmark_group("gcd");
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);

    group.bench_function("gcd", |b| {
        b.iter_batched(
            || {
                (
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                )
            },
            |(x, y)| black_box(x.gcd(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("gcd_vartime", |b| {
        b.iter_batched(
            || {
                (
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                )
            },
            |(x, y)| black_box(x.gcd_vartime(&y)),
            BatchSize::SmallInput,
        );
    });
}

fn bench_invert(c: &mut Criterion) {
    let mut group = c.benchmark_group("invert");
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);

    group.bench_function("invert_odd_mod", |b| {
        b.iter_batched(
            || {
                let (x, mut y) = (
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                );
                if y.is_even().into() {
                    y = y.wrapping_add(Limb::ONE);
                }
                (x, y.to_odd().unwrap())
            },
            |(x, y)| black_box(x.invert_odd_mod(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("invert_mod", |b| {
        b.iter_batched(
            || {
                let (x, mut y) = (
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                    BoxedUint::random_bits(&mut rng, UINT_BITS),
                );
                if y.is_zero().into() {
                    y = BoxedUint::one();
                }
                (x, y.to_nz().unwrap())
            },
            |(x, y)| black_box(x.invert_mod(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("invert_mod2k", |b| {
        b.iter_batched(
            || BoxedUint::random_bits(&mut rng, UINT_BITS),
            |x| x.invert_mod2k(black_box(1)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("invert_mod2k_vartime", |b| {
        b.iter_batched(
            || BoxedUint::random_bits(&mut rng, UINT_BITS),
            |x| x.invert_mod2k_vartime(black_box(1)),
            BatchSize::SmallInput,
        );
    });
}

criterion_group!(
    benches,
    bench_mul,
    bench_division,
    bench_shifts,
    bench_boxed_sqrt,
    bench_radix_encoding,
    bench_gcd,
    bench_invert,
);

criterion_main!(benches);
