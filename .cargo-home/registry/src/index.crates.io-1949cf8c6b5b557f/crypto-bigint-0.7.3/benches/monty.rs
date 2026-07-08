//! `MontyForm` benchmarks
#![allow(missing_docs)]

use chacha20::ChaCha8Rng;
use core::hint::black_box;
use criterion::{
    BatchSize, BenchmarkGroup, Criterion, criterion_group, criterion_main, measurement::Measurement,
};
use crypto_bigint::{
    Odd, Random, RandomMod, U256,
    modular::{FixedMontyForm, FixedMontyParams},
};
use rand_core::SeedableRng;

#[cfg(feature = "alloc")]
use crypto_bigint::MultiExponentiate;

/// Benchmark `MontyForm` conversions.
fn bench_montgomery_conversion<M: Measurement>(group: &mut BenchmarkGroup<'_, M>) {
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
    group.bench_function("MontyParams::new", |b| {
        b.iter_batched(
            || Odd::<U256>::random_from_rng(&mut rng),
            |modulus| black_box(FixedMontyParams::new(modulus)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("MontyParams::new_vartime", |b| {
        b.iter_batched(
            || Odd::<U256>::random_from_rng(&mut rng),
            |modulus| black_box(FixedMontyParams::new_vartime(modulus)),
            BatchSize::SmallInput,
        );
    });

    let params = FixedMontyParams::new_vartime(Odd::<U256>::random_from_rng(&mut rng));
    group.bench_function("MontyForm::new", |b| {
        b.iter_batched(
            || U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref()),
            |x| black_box(FixedMontyForm::new(&x, &params)),
            BatchSize::SmallInput,
        );
    });

    let params = FixedMontyParams::new_vartime(Odd::<U256>::random_from_rng(&mut rng));
    group.bench_function("MontyForm retrieve", |b| {
        b.iter_batched(
            || {
                FixedMontyForm::new(
                    &U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref()),
                    &params,
                )
            },
            |x| black_box(x.retrieve()),
            BatchSize::SmallInput,
        );
    });
}

fn bench_montgomery_ops<M: Measurement>(group: &mut BenchmarkGroup<'_, M>) {
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
    let params = FixedMontyParams::new_vartime(Odd::<U256>::random_from_rng(&mut rng));

    group.bench_function("add, U256", |b| {
        b.iter_batched(
            || {
                let a = FixedMontyForm::new(
                    &U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref()),
                    &params,
                );
                let b = FixedMontyForm::new(
                    &U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref()),
                    &params,
                );
                (a, b)
            },
            |(a, b)| black_box(a).add(&black_box(b)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("double, U256", |b| {
        b.iter_batched(
            || {
                FixedMontyForm::new(
                    &U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref()),
                    &params,
                )
            },
            |a| black_box(a).double(),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("sub, U256", |b| {
        b.iter_batched(
            || {
                let a = FixedMontyForm::new(
                    &U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref()),
                    &params,
                );
                let b = FixedMontyForm::new(
                    &U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref()),
                    &params,
                );
                (a, b)
            },
            |(a, b)| black_box(a).sub(&black_box(b)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("neg, U256", |b| {
        b.iter_batched(
            || {
                FixedMontyForm::new(
                    &U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref()),
                    &params,
                )
            },
            |a| black_box(a).neg(),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("invert, U256", |b| {
        b.iter_batched(
            || {
                FixedMontyForm::new(
                    &U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref()),
                    &params,
                )
            },
            |x| black_box(x).invert(),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("multiplication, U256*U256", |b| {
        b.iter_batched(
            || {
                let x = FixedMontyForm::new(
                    &U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref()),
                    &params,
                );
                let y = FixedMontyForm::new(
                    &U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref()),
                    &params,
                );
                (x, y)
            },
            |(x, y)| black_box(x * y),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("square, U256", |b| {
        b.iter_batched(
            || {
                FixedMontyForm::new(
                    &U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref()),
                    &params,
                )
            },
            |x| x.square(),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("pow, U256^U256", |b| {
        b.iter_batched(
            || {
                let x = U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref());
                let x_m = FixedMontyForm::new(&x, &params);
                let p = U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref())
                    | (U256::ONE << (U256::BITS - 1));
                (x_m, p)
            },
            |(x, p)| x.pow(black_box(&p)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("pow_vartime, U256^U256", |b| {
        b.iter_batched(
            || {
                let x = U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref());
                let x_m = FixedMontyForm::new(&x, &params);
                let p = U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref())
                    | (U256::ONE << (U256::BITS - 1));
                (x_m, p)
            },
            |(x, p)| x.pow_vartime(black_box(&p)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("div_by_2, U256", |b| {
        b.iter_batched(
            || {
                let x = U256::random_mod_vartime(&mut rng, params.modulus().as_nz_ref());
                FixedMontyForm::new(&x, &params)
            },
            |x| black_box(x.div_by_2()),
            BatchSize::SmallInput,
        );
    });

    #[cfg(feature = "alloc")]
    for i in [1, 2, 3, 4, 10, 100] {
        group.bench_function(
            format!("multi_exponentiate for {i} bases, U256^U256"),
            |b| {
                b.iter_batched(
                    || {
                        let bases_and_exponents: Vec<(FixedMontyForm<{ U256::LIMBS }>, U256)> = (1
                            ..=i)
                            .map(|_| {
                                let x = U256::random_mod_vartime(
                                    &mut rng,
                                    params.modulus().as_nz_ref(),
                                );
                                let x_m = FixedMontyForm::new(&x, &params);
                                let p = U256::random_mod_vartime(
                                    &mut rng,
                                    params.modulus().as_nz_ref(),
                                ) | (U256::ONE << (U256::BITS - 1));
                                (x_m, p)
                            })
                            .collect();

                        bases_and_exponents
                    },
                    |bases_and_exponents| {
                        black_box(FixedMontyForm::<{ U256::LIMBS }>::multi_exponentiate(
                            bases_and_exponents.as_slice(),
                        ))
                    },
                    BatchSize::SmallInput,
                );
            },
        );
    }
}

/// Benchmark `MontyForm`.
fn bench_montgomery(c: &mut Criterion) {
    let mut group = c.benchmark_group("Dynamic Montgomery arithmetic");
    bench_montgomery_conversion(&mut group);
    bench_montgomery_ops(&mut group);
    group.finish();
}

criterion_group!(benches, bench_montgomery);

criterion_main!(benches);
