//! `ConstMontyForm` benchmarks
#![allow(missing_docs)]

use chacha20::ChaCha8Rng;
use core::hint::black_box;
use criterion::{
    BatchSize, BenchmarkGroup, Criterion, criterion_group, criterion_main, measurement::Measurement,
};
use crypto_bigint::{Random, RandomMod, U256, const_monty_params, modular::ConstMontyParams};
use rand_core::SeedableRng;

#[cfg(feature = "alloc")]
use crypto_bigint::MultiExponentiate;

const_monty_params!(
    Modulus,
    U256,
    "7fffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);

type ConstMontyForm = crypto_bigint::modular::ConstMontyForm<Modulus, { U256::LIMBS }>;

fn bench_montgomery_conversion<M: Measurement>(group: &mut BenchmarkGroup<'_, M>) {
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
    group.bench_function("ConstMontyForm creation", |b| {
        b.iter_batched(
            || U256::random_mod_vartime(&mut rng, Modulus::PARAMS.modulus().as_nz_ref()),
            |x| black_box(ConstMontyForm::new(&x)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("ConstMontyForm retrieve", |b| {
        b.iter_batched(
            || ConstMontyForm::random_from_rng(&mut rng),
            |x| black_box(x.retrieve()),
            BatchSize::SmallInput,
        );
    });
}

fn bench_montgomery_ops<M: Measurement>(group: &mut BenchmarkGroup<'_, M>) {
    let mut rng = ChaCha8Rng::from_seed([7u8; 32]);

    group.bench_function("add, U256", |b| {
        b.iter_batched(
            || {
                let a = ConstMontyForm::random_from_rng(&mut rng);
                let b = ConstMontyForm::random_from_rng(&mut rng);
                (a, b)
            },
            |(a, b)| black_box(a).add(&black_box(b)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("double, U256", |b| {
        b.iter_batched(
            || ConstMontyForm::random_from_rng(&mut rng),
            |a| black_box(a).double(),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("sub, U256", |b| {
        b.iter_batched(
            || {
                let a = ConstMontyForm::random_from_rng(&mut rng);
                let b = ConstMontyForm::random_from_rng(&mut rng);
                (a, b)
            },
            |(a, b)| black_box(a).sub(&black_box(b)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("neg, U256", |b| {
        b.iter_batched(
            || ConstMontyForm::random_from_rng(&mut rng),
            |a| black_box(a).neg(),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("invert, U256", |b| {
        b.iter_batched(
            || ConstMontyForm::random_from_rng(&mut rng),
            |x| black_box(x).invert(),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("multiplication, U256*U256", |b| {
        b.iter_batched(
            || {
                let x = ConstMontyForm::random_from_rng(&mut rng);
                let y = ConstMontyForm::random_from_rng(&mut rng);
                (x, y)
            },
            |(x, y)| black_box(x).mul(&black_box(y)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("squaring, U256*U256", |b| {
        b.iter_batched(
            || ConstMontyForm::random_from_rng(&mut rng),
            |x| black_box(x).square(),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("pow, U256^U256", |b| {
        b.iter_batched(
            || {
                let x_m = ConstMontyForm::random_from_rng(&mut rng);
                let p = U256::random_from_rng(&mut rng) | (U256::ONE << (U256::BITS - 1));
                (x_m, p)
            },
            |(x, p)| x.pow(black_box(&p)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("pow_vartime, U256^U256", |b| {
        b.iter_batched(
            || {
                let x_m = ConstMontyForm::random_from_rng(&mut rng);
                let p = U256::random_from_rng(&mut rng) | (U256::ONE << (U256::BITS - 1));
                (x_m, p)
            },
            |(x, p)| x.pow_vartime(black_box(&p)),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("jacobi_symbol", |b| {
        b.iter_batched(
            || ConstMontyForm::random_from_rng(&mut rng),
            |a| a.jacobi_symbol(),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("jacobi_symbol_vartime", |b| {
        b.iter_batched(
            || ConstMontyForm::random_from_rng(&mut rng),
            |a| a.jacobi_symbol_vartime(),
            BatchSize::SmallInput,
        );
    });

    group.bench_function("lincomb, U256*U256+U256*U256", |b| {
        b.iter_batched(
            || ConstMontyForm::random_from_rng(&mut rng),
            |a| {
                ConstMontyForm::lincomb(&[
                    (black_box(a), black_box(a)),
                    (black_box(a), black_box(a)),
                ])
            },
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
                        let bases_and_exponents: Vec<(ConstMontyForm, U256)> = (1..=i)
                            .map(|_| {
                                let x_m = ConstMontyForm::random_from_rng(&mut rng);
                                let p = U256::random_from_rng(&mut rng)
                                    | (U256::ONE << (U256::BITS - 1));
                                (x_m, p)
                            })
                            .collect();

                        bases_and_exponents
                    },
                    |bases_and_exponents| {
                        black_box(ConstMontyForm::multi_exponentiate(
                            bases_and_exponents.as_slice(),
                        ))
                    },
                    BatchSize::SmallInput,
                );
            },
        );
    }
}

fn bench_montgomery_sqrt<M: Measurement>(group: &mut BenchmarkGroup<'_, M>) {
    use crypto_bigint::{U256, const_prime_monty_params, modular::ConstPrimeMontyParams};

    {
        // P-256 field modulus
        // p = 3 mod 4, s = 1, uses Shanks algorithm
        const_prime_monty_params!(
            P256Field,
            U256,
            "ffffffff00000001000000000000000000000000ffffffffffffffffffffffff",
            6
        );
        assert_eq!(P256Field::PRIME_PARAMS.s().get(), 1);
        type ConstForm = crypto_bigint::modular::ConstMontyForm<P256Field, { U256::LIMBS }>;

        let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
        group.bench_function("sqrt, U256, s=1", |b| {
            b.iter_batched(
                || {
                    let x =
                        U256::random_mod_vartime(&mut rng, P256Field::PARAMS.modulus().as_nz_ref());
                    ConstForm::new(&x)
                },
                |x| x.sqrt(),
                BatchSize::SmallInput,
            );
        });
    }

    {
        // P-256 scalar modulus
        // p = 17 mod 32, s = 4
        const_prime_monty_params!(
            P256Scalar,
            U256,
            "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
            7
        );
        assert_eq!(P256Scalar::PRIME_PARAMS.s().get(), 4);
        type ConstForm = crypto_bigint::modular::ConstMontyForm<P256Scalar, { U256::LIMBS }>;

        let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
        group.bench_function("sqrt, U256, s=4", |b| {
            b.iter_batched(
                || {
                    let x = U256::random_mod_vartime(
                        &mut rng,
                        P256Scalar::PARAMS.modulus().as_nz_ref(),
                    );
                    ConstForm::new(&x)
                },
                |x| x.sqrt(),
                BatchSize::SmallInput,
            );
        });
    }

    {
        // K-256 scalar modulus
        // s = 6, uses Tonelli-Shanks
        const_prime_monty_params!(
            K256Scalar,
            U256,
            "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141",
            7
        );
        assert_eq!(K256Scalar::PRIME_PARAMS.s().get(), 6);
        type ConstForm = crypto_bigint::modular::ConstMontyForm<K256Scalar, { U256::LIMBS }>;

        let mut rng = ChaCha8Rng::from_seed([7u8; 32]);
        group.bench_function("sqrt, U256, s=6", |b| {
            b.iter_batched(
                || {
                    let x = U256::random_mod_vartime(
                        &mut rng,
                        K256Scalar::PARAMS.modulus().as_nz_ref(),
                    );
                    ConstForm::new(&x)
                },
                |x| x.sqrt(),
                BatchSize::SmallInput,
            );
        });
    }
}

fn bench_montgomery(c: &mut Criterion) {
    let mut group = c.benchmark_group("Const Montgomery arithmetic");
    bench_montgomery_conversion(&mut group);
    bench_montgomery_ops(&mut group);
    bench_montgomery_sqrt(&mut group);
    group.finish();
}

criterion_group!(benches, bench_montgomery);
criterion_main!(benches);
