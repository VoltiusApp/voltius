#![feature(test)]
#![cfg(feature = "alloc")]

extern crate test;

use spki::SubjectPublicKeyInfoRef;
use test::{Bencher, black_box};

/// Ed25519 `SubjectPublicKeyInfo` encoded as ASN.1 DER
const ED25519_DER_EXAMPLE: &[u8] = include_bytes!("../tests/examples/ed25519-pub.der");

#[bench]
fn bench_spki_decode(b: &mut Bencher) {
    b.iter(|| {
        let pk_encoded = black_box(ED25519_DER_EXAMPLE);
        black_box(SubjectPublicKeyInfoRef::try_from(pk_encoded)).unwrap();
    });
    b.bytes = ED25519_DER_EXAMPLE.len() as u64;
}

#[bench]
fn bench_spki_encode(b: &mut Bencher) {
    let pk = SubjectPublicKeyInfoRef::try_from(ED25519_DER_EXAMPLE).unwrap();
    let mut buf = [0u8; 256];

    use der::Encode;
    b.iter(|| {
        let pk = black_box(&pk);
        black_box(pk.encode_to_slice(&mut buf)).unwrap();
    });
    b.bytes = ED25519_DER_EXAMPLE.len() as u64;
}
