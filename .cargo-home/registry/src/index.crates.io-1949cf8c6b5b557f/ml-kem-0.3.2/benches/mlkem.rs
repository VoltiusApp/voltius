//! ML-KEM benchmarks.

#![allow(missing_docs, clippy::unwrap_used)]

use ::kem::{Decapsulate, Encapsulate, Kem, KeyExport, KeyInit};
use core::hint::black_box;
use criterion::{Criterion, criterion_group, criterion_main};
use getrandom::SysRng;
use ml_kem::*;
use rand_core::UnwrapErr;

fn criterion_benchmark(c: &mut Criterion) {
    let mut rng = UnwrapErr(SysRng);

    // Key generation
    c.bench_function("keygen", |b| {
        b.iter(|| {
            let (dk, ek) = MlKem768::generate_keypair_from_rng(&mut rng);
            let _dk_bytes = black_box(dk.to_seed().unwrap());
            let _ek_bytes = black_box(ek.to_bytes());
        });
    });

    let (dk, ek) = MlKem768::generate_keypair_from_rng(&mut rng);
    let dk_bytes = dk.to_seed().unwrap();
    let ek_bytes = ek.to_bytes();
    let ek = <MlKem768 as Kem>::EncapsulationKey::new(&ek_bytes).unwrap();

    // Encapsulation
    c.bench_function("encapsulate", |b| {
        b.iter(|| ek.encapsulate_with_rng(&mut rng));
    });
    let (ct, _sk) = ek.encapsulate_with_rng(&mut rng);

    // Decapsulation
    let dk = <MlKem768 as Kem>::DecapsulationKey::new(&dk_bytes);

    c.bench_function("decapsulate", |b| {
        b.iter(|| {
            dk.decapsulate(&ct);
        });
    });

    // Round trip
    c.bench_function("round_trip", |b| {
        b.iter(|| {
            let (dk, ek) = MlKem768::generate_keypair_from_rng(&mut rng);
            let (ct, _sk) = ek.encapsulate_with_rng(&mut rng);
            dk.decapsulate(&ct);
        });
    });
}

criterion_group!(benches, criterion_benchmark);
criterion_main!(benches);
