# [RustCrypto]: PHC String Format

[![crate][crate-image]][crate-link]
[![Docs][docs-image]][docs-link]
[![Build Status][build-image]][build-link]
![Apache2/MIT licensed][license-image]
![Rust Version][rustc-image]
[![Project Chat][chat-image]][chat-link]

Pure Rust implementation of the [Password Hashing Competition (PHC) string format][phc-sf-spec],
which is used to store password hashes.

### Example (Argon2):

```text
$argon2d$v=19$m=512,t=3,p=2$5VtWOO3cGWYQHEMaYGbsfQ$AcmqasQgW/wI6wAHAMk4aQ
```

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

[crate-image]: https://img.shields.io/crates/v/phc?logo=rust
[crate-link]: https://crates.io/crates/phc
[docs-image]: https://docs.rs/phc/badge.svg
[docs-link]: https://docs.rs/phc/
[build-image]: https://github.com/RustCrypto/formats/actions/workflows/phc.yml/badge.svg
[build-link]: https://github.com/RustCrypto/formats/actions/workflows/phc.yml
[license-image]: https://img.shields.io/badge/license-Apache2.0/MIT-blue.svg
[rustc-image]: https://img.shields.io/badge/rustc-1.85+-blue.svg
[chat-image]: https://img.shields.io/badge/zulip-join_chat-blue.svg
[chat-link]: https://rustcrypto.zulipchat.com/#narrow/stream/300570-formats

[//]: # (links)

[RustCrypto]: https://github.com/rustcrypto
[phc-sf-spec]: https://github.com/P-H-C/phc-string-format/blob/master/phc-sf-spec.md
