# [RustCrypto]: Module Lattice

[![crate][crate-image]][crate-link]
[![Docs][docs-image]][docs-link]
[![Build Status][build-image]][build-link]
![Apache2/MIT licensed][license-image]
![Rust Version][rustc-image]
[![Project Chat][chat-image]][chat-link]
[![HAZMAT][hazmat-image]][hazmat-link]

Functionality shared between the [`ml-kem`] and [`ml-dsa`] crates, which provide implementations of post-quantum secure
algorithms for key encapsulation and digital signatures respectively.

## About

The "ML" in ML-KEM and ML-DSA stands for "module lattice". This crate contains the following common functionality for
these algorithms:
- Linear algebra with degree-256 polynomials over a prime-order field, vectors of such polynomials, and NTT
  polynomials / vectors.
- Packing of polynomials into coefficients with a specified number of bits.
- Utility functions such as truncating integers

## ⚠️ Warning: [Hazmat!][hazmat-link]

This crate is intended solely for the purposes of implementing the `ml-kem` and `ml-dsa` crates and should not be used
outside of that purpose.

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

[crate-image]: https://img.shields.io/crates/v/module-lattice?logo=rust
[crate-link]: https://crates.io/crates/module-lattice
[docs-image]: https://docs.rs/module-lattice/badge.svg
[docs-link]: https://docs.rs/module-lattice/
[build-image]: https://github.com/RustCrypto/KEMs/actions/workflows/module-lattice.yml/badge.svg
[build-link]: https://github.com/RustCrypto/KEMs/actions/workflows/module-lattice.yml
[license-image]: https://img.shields.io/badge/license-Apache2.0/MIT-blue.svg
[rustc-image]: https://img.shields.io/badge/rustc-1.85+-blue.svg
[chat-image]: https://img.shields.io/badge/zulip-join_chat-blue.svg
[chat-link]: https://rustcrypto.zulipchat.com/#narrow/stream/406484-KEMs
[hazmat-image]: https://img.shields.io/badge/crypto-hazmat%E2%9A%A0-red.svg
[hazmat-link]: https://github.com/RustCrypto/meta/blob/master/HAZMAT.md

[//]: # (links)

[RustCrypto]: https://github.com/rustcrypto
[`ml-kem`]: https://docs.rs/ml-kem
[`ml-dsa`]: https://docs.rs/ml-dsa
