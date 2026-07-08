# [RustCrypto]: Keccak Sponge Function

[![crate][crate-image]][crate-link]
[![Docs][docs-image]][docs-link]
[![Build Status][build-image]][build-link]
![Apache2/MIT licensed][license-image]
![Rust Version][rustc-image]
[![Project Chat][chat-image]][chat-link]

Pure Rust implementation of the [Keccak Sponge Function][keccak] including the `keccak-f`
and `keccak-p` variants.

## About

This crate implements the core Keccak sponge function, upon which many other
cryptographic functions are built.

For the SHA-3 family including the SHAKE XOFs, see the [`sha3`] crate, which
is built on this crate.

## Examples

```rust
// Test vector from KeccakCodePackage
let mut state = [0u64; 25];

keccak::Keccak::new().with_f1600(|f1600| {
    f1600(&mut state);
    assert_eq!(state, [
        0xF1258F7940E1DDE7, 0x84D5CCF933C0478A, 0xD598261EA65AA9EE, 0xBD1547306F80494D,
        0x8B284E056253D057, 0xFF97A42D7F8E6FD4, 0x90FEE5A0A44647C4, 0x8C5BDA0CD6192E76,
        0xAD30A6F71B19059C, 0x30935AB7D08FFC64, 0xEB5AA93F2317D635, 0xA9A6E6260D712103,
        0x81A57C16DBCF555F, 0x43B831CD0347C826, 0x01F22F1A11A5569F, 0x05E5635A21D9AE61,
        0x64BEFEF28CC970F2, 0x613670957BC46611, 0xB87C5A554FD00ECB, 0x8C3EE88A1CCF32C8,
        0x940C7922AE3A2614, 0x1841F924A2C509E4, 0x16F53526E70465C2, 0x75F644E97F30A13B,
        0xEAF1FF7B5CECA249,
    ]);

    f1600(&mut state);
    assert_eq!(state, [
        0x2D5C954DF96ECB3C, 0x6A332CD07057B56D, 0x093D8D1270D76B6C, 0x8A20D9B25569D094,
        0x4F9C4F99E5E7F156, 0xF957B9A2DA65FB38, 0x85773DAE1275AF0D, 0xFAF4F247C3D810F7,
        0x1F1B9EE6F79A8759, 0xE4FECC0FEE98B425, 0x68CE61B6B9CE68A1, 0xDEEA66C4BA8F974F,
        0x33C43D836EAFB1F5, 0xE00654042719DBD9, 0x7CF8A9F009831265, 0xFD5449A6BF174743,
        0x97DDAD33D8994B40, 0x48EAD5FC5D0BE774, 0xE3B8C8EE55B7B03C, 0x91A0226E649E42E9,
        0x900E3129E7BADD7B, 0x202A9EC5FAA3CCE8, 0x5B3402464E1C3DB6, 0x609F4E62A44C1059,
        0x20D06CD26A8FBF5C,
    ]);
});
```

## Configuration flags

You can modify crate using the following configuration flags:

- `keccak_backend`: select the specified backend. Supported values:
    - `aarch64_sha3`: AArch64-specific backend based on the `sha3` extension.
    - `simd128/256/512`: backend based on the portable SIMD API. Requires Nightly compiler.
    - `soft`: portable software backend.
- `keccak_backend_soft="compact"`: control software backend implementation. Supported values:
    - `compact`: do not unroll loops. Reduces performance, but results in a more compact binary code.

The flags can be enabled using `RUSTFLAGS` environment variable
(e.g. `RUSTFLAGS='--cfg keccak_backend="soft"'`) or by modifying `.cargo/config.toml`.

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

[crate-image]: https://img.shields.io/crates/v/keccak.svg
[crate-link]: https://crates.io/crates/keccak
[docs-image]: https://docs.rs/keccak/badge.svg
[docs-link]: https://docs.rs/keccak/
[build-image]: https://github.com/RustCrypto/sponges/actions/workflows/keccak.yml/badge.svg
[build-link]: https://github.com/RustCrypto/sponges/actions/workflows/keccak.yml
[license-image]: https://img.shields.io/badge/license-Apache2.0/MIT-blue.svg
[rustc-image]: https://img.shields.io/badge/rustc-1.85+-blue.svg
[chat-image]: https://img.shields.io/badge/zulip-join_chat-blue.svg
[chat-link]: https://rustcrypto.zulipchat.com/#narrow/stream/369879-sponges

[//]: # (links)

[RustCrypto]: https://github.com/RustCrypto
[keccak]: https://keccak.team/keccak.html
[`sha3`]: https://github.com/RustCrypto/hashes/tree/master/sha3
