//! `Int` benchmarks
#![allow(missing_docs)]

use chacha20::ChaCha8Rng;
use core::hint::black_box;
use core::ops::Div;
use criterion::{BatchSize, Criterion, criterion_group, criterion_main};
use rand_core::SeedableRng;

use crypto_bigint::{I128, I256, I512, I1024, I2048, I4096, NonZero, Random};

/// Benchmark `Int` multiplication.
fn bench_mul(c: &mut Criterion) {
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
    let mut group = c.benchmark_group("wrapping ops");

    group.bench_function("widening_mul, I128xI128", |b| {
        b.iter_batched(
            || {
                (
                    I256::random_from_rng(&mut rng),
                    I256::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.widening_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("widening_mul, I256xI256", |b| {
        b.iter_batched(
            || {
                (
                    I256::random_from_rng(&mut rng),
                    I256::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.widening_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("widening_mul, I512xI512", |b| {
        b.iter_batched(
            || {
                (
                    I512::random_from_rng(&mut rng),
                    I512::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.widening_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("widening_mul, I1024xI1024", |b| {
        b.iter_batched(
            || {
                (
                    I1024::random_from_rng(&mut rng),
                    I1024::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.widening_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("widening_mul, I2048xI2048", |b| {
        b.iter_batched(
            || {
                (
                    I2048::random_from_rng(&mut rng),
                    I2048::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.widening_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("widening_mul, I4096xI4096", |b| {
        b.iter_batched(
            || {
                (
                    I4096::random_from_rng(&mut rng),
                    I4096::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.widening_mul(&y)),
            BatchSize::SmallInput,
        );
    });
}

fn bench_concatenating_mul(c: &mut Criterion) {
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
    let mut group = c.benchmark_group("widening ops");

    group.bench_function("concatenating_mul, I128xI128", |b| {
        b.iter_batched(
            || {
                (
                    I128::random_from_rng(&mut rng),
                    I128::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.concatenating_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("concatenating_mul, I256xI256", |b| {
        b.iter_batched(
            || {
                (
                    I256::random_from_rng(&mut rng),
                    I256::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.concatenating_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("concatenating_mul, I512xI512", |b| {
        b.iter_batched(
            || {
                (
                    I512::random_from_rng(&mut rng),
                    I512::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.concatenating_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("concatenating_mul, I1024xI1024", |b| {
        b.iter_batched(
            || {
                (
                    I1024::random_from_rng(&mut rng),
                    I1024::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.concatenating_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("concatenating_mul, I2048xI2048", |b| {
        b.iter_batched(
            || {
                (
                    I2048::random_from_rng(&mut rng),
                    I2048::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.concatenating_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("concatenating_mul, I4096xI4096", |b| {
        b.iter_batched(
            || {
                (
                    I4096::random_from_rng(&mut rng),
                    I4096::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.concatenating_mul(&y)),
            BatchSize::SmallInput,
        );
    });
}

fn bench_wrapping_mul(c: &mut Criterion) {
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
    let mut group = c.benchmark_group("wrapping ops");

    group.bench_function("wrapping_mul, I128xI128", |b| {
        b.iter_batched(
            || {
                (
                    I256::random_from_rng(&mut rng),
                    I256::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.wrapping_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("wrapping_mul, I256xI256", |b| {
        b.iter_batched(
            || {
                (
                    I256::random_from_rng(&mut rng),
                    I256::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.wrapping_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("wrapping_mul, I512xI512", |b| {
        b.iter_batched(
            || {
                (
                    I512::random_from_rng(&mut rng),
                    I512::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.wrapping_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("wrapping_mul, I1024xI1024", |b| {
        b.iter_batched(
            || {
                (
                    I1024::random_from_rng(&mut rng),
                    I1024::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.wrapping_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("wrapping_mul, I2048xI2048", |b| {
        b.iter_batched(
            || {
                (
                    I2048::random_from_rng(&mut rng),
                    I2048::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.wrapping_mul(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("wrapping_mul, I4096xI4096", |b| {
        b.iter_batched(
            || {
                (
                    I4096::random_from_rng(&mut rng),
                    I4096::random_from_rng(&mut rng),
                )
            },
            |(x, y)| black_box(x.wrapping_mul(&y)),
            BatchSize::SmallInput,
        );
    });
}

fn bench_div(c: &mut Criterion) {
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
    let mut group = c.benchmark_group("wrapping ops");

    group.bench_function("div, I256/I128, full size", |b| {
        b.iter_batched(
            || {
                let x = I256::random_from_rng(&mut rng);
                let y = I128::random_from_rng(&mut rng).resize::<{ I256::LIMBS }>();
                (x, NonZero::new(y).unwrap())
            },
            |(x, y)| black_box(x.div(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("div, I512/I256, full size", |b| {
        b.iter_batched(
            || {
                let x = I512::random_from_rng(&mut rng);
                let y = I256::random_from_rng(&mut rng).resize::<{ I512::LIMBS }>();
                (x, NonZero::new(y).unwrap())
            },
            |(x, y)| black_box(x.div(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("div, I1024/I512, full size", |b| {
        b.iter_batched(
            || {
                let x = I1024::random_from_rng(&mut rng);
                let y = I512::random_from_rng(&mut rng).resize::<{ I1024::LIMBS }>();
                (x, NonZero::new(y).unwrap())
            },
            |(x, y)| black_box(x.div(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("div, I2048/I1024, full size", |b| {
        b.iter_batched(
            || {
                let x = I2048::random_from_rng(&mut rng);
                let y = I1024::random_from_rng(&mut rng).resize::<{ I2048::LIMBS }>();
                (x, NonZero::new(y).unwrap())
            },
            |(x, y)| black_box(x.div(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("div, I4096/I2048, full size", |b| {
        b.iter_batched(
            || {
                let x = I4096::random_from_rng(&mut rng);
                let y = I2048::random_from_rng(&mut rng).resize::<{ I4096::LIMBS }>();
                (x, NonZero::new(y).unwrap())
            },
            |(x, y)| black_box(x.div(&y)),
            BatchSize::SmallInput,
        );
    });

    group.finish();
}

fn bench_add(c: &mut Criterion) {
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
    let mut group = c.benchmark_group("wrapping ops");

    group.bench_function("add, I128+I128", |b| {
        b.iter_batched(
            || {
                let x = I128::random_from_rng(&mut rng);
                let y = I128::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.wrapping_add(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("add, I256+I256", |b| {
        b.iter_batched(
            || {
                let x = I256::random_from_rng(&mut rng);
                let y = I256::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.wrapping_add(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("add, I512+I512", |b| {
        b.iter_batched(
            || {
                let x = I512::random_from_rng(&mut rng);
                let y = I512::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.wrapping_add(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("add, I1024+I1024", |b| {
        b.iter_batched(
            || {
                let x = I1024::random_from_rng(&mut rng);
                let y = I1024::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.wrapping_add(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("add, I2048+I2048", |b| {
        b.iter_batched(
            || {
                let x = I2048::random_from_rng(&mut rng);
                let y = I2048::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.wrapping_add(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("add, I4096+I4096", |b| {
        b.iter_batched(
            || {
                let x = I4096::random_from_rng(&mut rng);
                let y = I4096::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.wrapping_add(&y)),
            BatchSize::SmallInput,
        );
    });

    group.finish();
}

fn bench_sub(c: &mut Criterion) {
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
    let mut group = c.benchmark_group("wrapping ops");

    group.bench_function("sub, I128-I128", |b| {
        b.iter_batched(
            || {
                let x = I128::random_from_rng(&mut rng);
                let y = I128::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.wrapping_sub(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("sub, I256-I256", |b| {
        b.iter_batched(
            || {
                let x = I256::random_from_rng(&mut rng);
                let y = I256::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.wrapping_sub(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("sub, I512-I512", |b| {
        b.iter_batched(
            || {
                let x = I512::random_from_rng(&mut rng);
                let y = I512::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.wrapping_sub(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("sub, I1024-I1024", |b| {
        b.iter_batched(
            || {
                let x = I1024::random_from_rng(&mut rng);
                let y = I1024::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.wrapping_sub(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("sub, I2048-I2048", |b| {
        b.iter_batched(
            || {
                let x = I2048::random_from_rng(&mut rng);
                let y = I2048::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.wrapping_sub(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("sub, I4096-I4096", |b| {
        b.iter_batched(
            || {
                let x = I4096::random_from_rng(&mut rng);
                let y = I4096::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.wrapping_sub(&y)),
            BatchSize::SmallInput,
        );
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_mul,
    bench_concatenating_mul,
    bench_wrapping_mul,
    bench_div,
    bench_add,
    bench_sub,
);

criterion_main!(benches);
