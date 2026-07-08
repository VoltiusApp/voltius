# dbus Secret Service keyring store

[![build](https://github.com/open-source-cooperative/dbus-secret-service-keyring-store/actions/workflows/ci.yaml/badge.svg)](https://github.com/open-source-cooperative/dbus-secret-service-keyring-store/actions) [![crates.io](https://img.shields.io/crates/v/dbus-secret-service-keyring-store.svg?style=flat-square)](https://crates.io/crates/dbus-secret-service-keyring-store) [![docs.rs](https://docs.rs/dbus-secret-service-keyring-store/badge.svg)](https://docs.rs/dbus-secret-service-keyring-store)

This library provides a credential store for use with the [keyring ecosystem](https://github.com/open-source-cooperative/keyring-rs/wiki/Keyring) that uses the [Secret Service](https://specifications.freedesktop.org/secret-service/latest/description.html) for credential storage.

## Usage

To use this credential store provider, you must take a dependency on the [keyring-core crate](https://crates.io/crates/keyring-core) and on [this crate](https://crates.io/crates/dbus-secret-service-keyring-store). Then you instantiate and use a credential store as shown in the [example program](https://github.com/open-source-cooperative/dbus-secret-service-keyring-store/blob/main/examples/example.rs) in this crate. See the [docs for this crate](https://docs.rs/docs/dbus-secret-service-keyring-store) for more detail.

## Features

You must enable either the `crypto-rust` or the `crypto-openssl` feature because this crate always encrypts communication with the Secret Service. You can additionally enable the `vendored` feature if you want the required C libraries (dbus and, if specified, openssl) statically linked with your application.

## Changelog

See the [release history on GitHub](https://github.com/open-source-cooperative/dbus-secret-service-keyring-store/releases) for full details.

## License

Licensed under either of

* Apache License, Version 2.0, ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
* MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you shall be dual licensed as above, without any additional terms or conditions.
