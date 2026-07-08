//! `Limb` benchmarks
#![allow(missing_docs)]

use chacha20::ChaCha8Rng;
use core::hint::black_box;
use criterion::{
    BatchSize, BenchmarkGroup, Criterion, criterion_group, criterion_main, measurement::Measurement,
};
use crypto_bigint::{CtEq, CtGt, CtLt, Limb, Random};
use rand_core::SeedableRng;

/// Benchmark constant-time comparisons.
fn bench_cmp<M: Measurement>(group: &mut BenchmarkGroup<'_, M>) {
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
    group.bench_function("ct_lt", |b| {
        b.iter_batched(
            || {
                let x = Limb::random_from_rng(&mut rng);
                let y = Limb::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.ct_lt(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("ct_eq", |b| {
        b.iter_batched(
            || {
                let x = Limb::random_from_rng(&mut rng);
                let y = Limb::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.ct_eq(&y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("ct_gt", |b| {
        b.iter_batched(
            || {
                let x = Limb::random_from_rng(&mut rng);
                let y = Limb::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x.ct_gt(&y)),
            BatchSize::SmallInput,
        );
    });
}

/// Benchmark `Limb` operations.
fn bench_ops(c: &mut Criterion) {
    let mut group = c.benchmark_group("ops");
    bench_cmp(&mut group);
    group.finish();
}

criterion_group!(benches, bench_ops);

criterion_main!(benches);
