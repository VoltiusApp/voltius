# Linux Keyutils Keyring Store

[![build](https://github.com/open-source-cooperative/linux-keyutils-keyring-store/actions/workflows/ci.yaml/badge.svg)](https://github.com/open-source-cooperative/linux-keyutils-keyring-store/actions) [![crates.io](https://img.shields.io/crates/v/linux-keyutils-keyring-store.svg?style=flat-square)](https://crates.io/crates/linux-keyutils-keyring-store) [![docs.rs](https://docs.rs/linux-keyutils-keyring-store/badge.svg)](https://docs.rs/linux-keyutils-keyring-store)

This library provides a credential store for use with the [keyring ecosystem](https://github.com/open-source-cooperative/keyring-rs/wiki/Keyring) that uses the Linux key-management facility (keyctl).

## Usage

To use this keychain-compatible credential store provider, you must take a dependency on the [keyring-core crate](https://crates.io/crates/keyring-core) and on [this crate](https://crates.io/crates/linux-keyutils-keyring-store). Then you can instantiate a credential store and set it as your default credential store as shown in the [sample program](https://github.com/open-source-cooperative/linux-keyutils-keyring-store/blob/main/examples/example.rs) in this crate.

## Changelog

See the [release history on GitHub](https://github.com/open-source-cooperative/linux-keyutils-keyring-store/releases) for full details.

## License

Licensed under either of the following at your discretion:

 * Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
 * MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you shall be dual licensed as above, without any
additional terms or conditions.
