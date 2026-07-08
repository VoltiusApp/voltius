# [RustCrypto]: PKCS#5

[![crate][crate-image]][crate-link]
[![Docs][docs-image]][docs-link]
[![Build Status][build-image]][build-link]
![Apache2/MIT licensed][license-image]
![Rust Version][rustc-image]
[![Project Chat][chat-image]][chat-link]

Pure Rust implementation of Public-Key Cryptography Standards (PKCS) #5:
Password-Based Cryptography Specification Version 2.1 ([RFC 8018]).

[Documentation][docs-link]

## About

PKCS#5 is a standard for deriving cryptographic keys from a password using a variety of supported
algorithms, and then encrypting/decrypting data (e.g. PKCS#8 private keys) using that derived key.

This crate supports deriving keys from passwords using either the `scrypt` or `pbkdf2` algorithms.

## Minimum Supported Rust Version (MSRV) Policy

MSRV increases are not considered breaking changes and can happen in patch releases.

The crate MSRV accounts for all supported targets and crate feature combinations, excluding
explicitly unstable features.

## License

Licensed under either of:

 * [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0)
 * [MIT license](http://opensource.org/licenses/MIT)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.

[//]: # (badges)

[crate-image]: https://img.shields.io/crates/v/pkcs5
[crate-link]: https://crates.io/crates/pkcs5
[docs-image]: https://docs.rs/pkcs5/badge.svg
[docs-link]: https://docs.rs/pkcs5/
[build-image]: https://github.com/RustCrypto/formats/actions/workflows/pkcs5.yml/badge.svg
[build-link]: https://github.com/RustCrypto/formats/actions/workflows/pkcs5.yml
[license-image]: https://img.shields.io/badge/license-Apache2.0/MIT-blue.svg
[rustc-image]: https://img.shields.io/badge/rustc-1.85+-blue.svg
[chat-image]: https://img.shields.io/badge/zulip-join_chat-blue.svg
[chat-link]: https://rustcrypto.zulipchat.com/#narrow/stream/300570-formats

[//]: # (links)

[RustCrypto]: https://github.com/rustcrypto
[RFC 8018]: https://tools.ietf.org/html/rfc8018
