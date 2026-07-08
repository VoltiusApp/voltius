# RustCrypto: `crypto_secretbox`

[![crate][crate-image]][crate-link]
[![Docs][docs-image]][docs-link]
![Apache2/MIT licensed][license-image]
![Rust Version][rustc-image]
[![Project Chat][chat-image]][chat-link]
[![Build Status][build-image]][build-link]

[`crypto_secretbox`][1] is an [authenticated symmetric encryption][2] cipher
amenable to fast, constant-time implementations in software, combining either the
[Salsa20][3] stream cipher (with [XSalsa20][4] 192-bit nonce extension) or
[ChaCha20][5] stream cipher with the [Poly1305][6] universal hash function,
which acts as a message authentication code.

This algorithm has largely been replaced by the newer IETF variant of
[ChaCha20Poly1305][7] (and the associated [XChaCha20Poly1305][8]) AEAD
ciphers ([RFC 8439][9]), but is useful for interoperability with legacy
NaCl-based protocols.

[Documentation][docs-link]

## Security Warning

No security audits of this crate have ever been performed, and it has not been
thoroughly assessed to ensure its operation is constant-time on common CPU
architectures.

USE AT YOUR OWN RISK!

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

[crate-image]: https://buildstats.info/crate/crypto_secretbox
[crate-link]: https://crates.io/crates/crypto_secretbox
[docs-image]: https://docs.rs/crypto_secretbox/badge.svg
[docs-link]: https://docs.rs/crypto_secretbox/
[license-image]: https://img.shields.io/badge/license-Apache2.0/MIT-blue.svg
[rustc-image]: https://img.shields.io/badge/rustc-1.60+-blue.svg
[chat-image]: https://img.shields.io/badge/zulip-join_chat-blue.svg
[chat-link]: https://rustcrypto.zulipchat.com/#narrow/stream/260038-AEADs
[build-image]: https://github.com/RustCrypto/nacl-compat/actions/workflows/crypto_secretbox.yml/badge.svg
[build-link]: https://github.com/RustCrypto/nacl-compat/actions/workflows/crypto_secretbox.yml

[//]: # (general links)

[1]: https://nacl.cr.yp.to/secretbox.html
[2]: https://en.wikipedia.org/wiki/Authenticated_encryption
[3]: https://github.com/RustCrypto/stream-ciphers/tree/master/salsa20
[4]: https://cr.yp.to/snuffle/xsalsa-20081128.pdf
[5]: https://cr.yp.to/chacha.html
[6]: https://github.com/RustCrypto/universal-hashes/tree/master/poly1305
[7]: https://github.com/RustCrypto/AEADs/tree/master/chacha20poly1305
[8]: https://docs.rs/chacha20poly1305/latest/chacha20poly1305/struct.XChaCha20Poly1305.html
[9]: https://tools.ietf.org/html/rfc8439
