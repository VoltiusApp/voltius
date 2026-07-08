# RustCrypto: Salsa20 Stream Cipher

[![Crate][crate-image]][crate-link]
[![Docs][docs-image]][docs-link]
[![Build Status][build-image]][build-link]
![Apache2/MIT licensed][license-image]
![Rust Version][rustc-image]
[![Project Chat][chat-image]][chat-link]
[![HAZMAT][hazmat-image]][hazmat-link]

Implementation of the [Salsa] family of stream ciphers, including the [XSalsa] variants with
an extended 192-bit (24-byte) nonce.

## ⚠️ Security Warning: [Hazmat!][hazmat-link]

This crate does not ensure ciphertexts are authentic (i.e. by using a MAC to
verify ciphertext integrity), which can lead to serious vulnerabilities
if used incorrectly!

No security audits of this crate have ever been performed, and it has not been
thoroughly assessed to ensure its operation is constant-time on common CPU
architectures.

USE AT YOUR OWN RISK!

# Examples

```rust
use salsa20::Salsa20;
use salsa20::cipher::{KeyIvInit, StreamCipher, StreamCipherSeek};
use hex_literal::hex;

let key = [0x42; 32];
let nonce = [0x24; 8];
let plaintext = hex!("000102030405060708090A0B0C0D0E0F");
let ciphertext = hex!("85843cc5d58cce7b5dd3dd04fa005ded");

// Key and IV must be references to the `Array` type.
// Here we use the `Into` trait to convert arrays into it.
let mut cipher = Salsa20::new(&key.into(), &nonce.into());

let mut buffer = plaintext;

// apply keystream (encrypt)
cipher.apply_keystream(&mut buffer);
assert_eq!(buffer, ciphertext);

let ciphertext = buffer;

// Salsa ciphers support seeking
cipher.seek(0u32);

// decrypt ciphertext by applying keystream again
cipher.apply_keystream(&mut buffer);
assert_eq!(buffer, plaintext);

// stream ciphers can be used with streaming messages
cipher.seek(0u32);
for chunk in buffer.chunks_mut(3) {
    cipher.apply_keystream(chunk);
}
assert_eq!(buffer, ciphertext);
```

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

[crate-image]: https://img.shields.io/crates/v/salsa20.svg
[crate-link]: https://crates.io/crates/salsa20
[docs-image]: https://docs.rs/salsa20/badge.svg
[docs-link]: https://docs.rs/salsa20/
[build-image]: https://github.com/RustCrypto/stream-ciphers/actions/workflows/salsa20.yml/badge.svg
[build-link]: https://github.com/RustCrypto/stream-ciphers/actions/workflows/salsa20.yml
[license-image]: https://img.shields.io/badge/license-Apache2.0/MIT-blue.svg
[rustc-image]: https://img.shields.io/badge/rustc-1.85+-blue.svg
[chat-image]: https://img.shields.io/badge/zulip-join_chat-blue.svg
[chat-link]: https://rustcrypto.zulipchat.com/#narrow/stream/260049-stream-ciphers
[hazmat-image]: https://img.shields.io/badge/crypto-hazmat%E2%9A%A0-red.svg
[hazmat-link]: https://github.com/RustCrypto/meta/blob/master/HAZMAT.md

[//]: # (footnotes)

[Salsa]: https://en.wikipedia.org/wiki/Salsa20
[XSalsa]: https://cr.yp.to/snuffle/xsalsa-20081128.pdf
