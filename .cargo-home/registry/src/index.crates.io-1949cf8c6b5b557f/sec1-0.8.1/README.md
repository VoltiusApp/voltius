# [RustCrypto]: SEC1 Elliptic Curve Cryptography Formats

[![crate][crate-image]][crate-link]
[![Docs][docs-image]][docs-link]
[![Build Status][build-image]][build-link]
![Apache2/MIT licensed][license-image]
![Rust Version][rustc-image]
[![Project Chat][chat-image]][chat-link]

[Documentation][docs-link]

## About

Pure Rust implementation of [SEC1: Elliptic Curve Cryptography] encoding
formats including ASN.1 DER-serialized private keys (also described in
[RFC5915]) as well as the `Elliptic-Curve-Point-to-Octet-String` and
`Octet-String-to-Elliptic-Curve-Point` encoding algorithms.

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

[crate-image]: https://img.shields.io/crates/v/sec1
[crate-link]: https://crates.io/crates/sec1
[docs-image]: https://docs.rs/sec1/badge.svg
[docs-link]: https://docs.rs/sec1/
[build-image]: https://github.com/RustCrypto/formats/actions/workflows/sec1.yml/badge.svg
[build-link]: https://github.com/RustCrypto/formats/actions/workflows/sec1.yml
[license-image]: https://img.shields.io/badge/license-Apache2.0/MIT-blue.svg
[rustc-image]: https://img.shields.io/badge/rustc-1.85+-blue.svg
[chat-image]: https://img.shields.io/badge/zulip-join_chat-blue.svg
[chat-link]: https://rustcrypto.zulipchat.com/#narrow/stream/300570-formats

[//]: # (links)

[RustCrypto]: https://github.com/rustcrypto
[SEC1: Elliptic Curve Cryptography]: https://www.secg.org/sec1-v2.pdf
[RFC5915]: https://datatracker.ietf.org/doc/html/rfc5915
