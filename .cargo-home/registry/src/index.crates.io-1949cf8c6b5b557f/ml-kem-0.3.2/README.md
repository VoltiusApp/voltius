# [RustCrypto]: ML-KEM

[![crate][crate-image]][crate-link]
[![Docs][docs-image]][docs-link]
[![Build Status][build-image]][build-link]
![Apache2/MIT licensed][license-image]
![Rust Version][rustc-image]
[![Project Chat][chat-image]][chat-link]

Pure Rust implementation of the Module-Lattice-Based Key-Encapsulation Mechanism Standard
(formerly known as Kyber) as described in [FIPS 203] (final).

[Documentation][docs-link]

## About

ML-KEM is an algorithm which uses public-key cryptography to securely transfer a symmetric key
between two parties who want to establish encrypted communications with each other. It uses
algorithms which resist potential attacks by hypothetical future quantum computers which,
when such computers are sufficiently mature, pose a problem for the algorithms we typically use for
secure key establishment using public-key cryptography such as (EC)DH and RSA key encipherment.

Originally developed as [CRYSTALS-Kyber] (a.k.a. "Kyber"), ML-KEM is a refinement of the original
Kyber algorithm after it was selected for standardization by [NIST]'s [Post-Quantum Cryptography]
(PQC) competition. The Kyber algorithm received considerable feedback as part of the standardization
process and as such, ML-KEM includes many changes from the original Kyber. It can be though of as
the official successor of Kyber.

In summary, ML-KEM stands at the forefront of post-quantum cryptography, offering enhanced security
and efficiency in key encapsulation mechanisms to safeguard sensitive communications in an era where
quantum computers potentially pose a looming threat.

## Features

The following features are provided by this crate:
* `zeroize` — Enables memory zeroing for all cryptographic secrets
* `pkcs8` — Enables PKCS#8 encoding/decoding traits for encapsulation and decapsulation key types
* `alloc` — Enables allocating PKCS#8 encoding functions
* `pem` — Enables PEM encoding/decoding support for PKCS#8 keys
* `hazmat` — Enables `EncapsulationKey::encapsulate_deterministic`. Useful for testing purposes. Do NOT enable unless you know what you are doing.

The **default** features are `[]` (nothing).

## ⚠️ Security Warning

The implementation contained in this crate has never been independently audited!

USE AT YOUR OWN RISK!

## Minimum Supported Rust Version (MSRV) Policy

MSRV increases are not considered breaking changes and can happen in patch
releases.

The crate MSRV accounts for all supported targets and crate feature
combinations, excluding explicitly unstable features.

## License

Licensed under either of:

- [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0)
- [MIT license](http://opensource.org/licenses/MIT)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.

[//]: # (badges)

[crate-image]: https://img.shields.io/crates/v/ml-kem?logo=rust
[crate-link]: https://crates.io/crates/ml-kem
[docs-image]: https://docs.rs/ml-kem/badge.svg
[docs-link]: https://docs.rs/ml-kem/
[build-image]: https://github.com/RustCrypto/KEMs/actions/workflows/ml-kem.yml/badge.svg
[build-link]: https://github.com/RustCrypto/KEMs/actions/workflows/ml-kem.yml
[license-image]: https://img.shields.io/badge/license-Apache2.0/MIT-blue.svg
[rustc-image]: https://img.shields.io/badge/rustc-1.85+-blue.svg
[chat-image]: https://img.shields.io/badge/zulip-join_chat-blue.svg
[chat-link]: https://rustcrypto.zulipchat.com/#narrow/stream/406484-KEMs

[//]: # (links)

[RustCrypto]: https://github.com/rustcrypto
[FIPS 203]: https://csrc.nist.gov/pubs/fips/203/final
[CRYSTALS-Kyber]: https://pq-crystals.org/kyber/
[NIST]: https://www.nist.gov/cryptography
[Post-Quantum Cryptography]: https://csrc.nist.gov/projects/post-quantum-cryptography
