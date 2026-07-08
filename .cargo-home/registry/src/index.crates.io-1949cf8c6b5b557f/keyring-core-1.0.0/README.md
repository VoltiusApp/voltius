## Keyring Core

[![build](https://github.com/open-source-cooperative/keyring-core/actions/workflows/ci.yaml/badge.svg)](https://github.com/open-source-cooperative/keyring-core/actions) [![crates.io](https://img.shields.io/crates/v/keyring-core.svg)](https://crates.io/crates/keyring-core) [![docs.rs](https://docs.rs/keyring-core/badge.svg)](https://docs.rs/keyring-core)

This crate, `keyring-core`, is part of the [Keyring ecosystem](https://github.com/open-source-cooperative/keyring-core/wiki/Keyring). It provides a cross-platform library to manage storage and retrieval of passwords (and other secrets) in secure credential stores, such as the [demonstration keyring applications](https://github.com/open-source-cooperative/keyring-rs/wiki/Keyring-Applications). If you are a developer looking to integrate secret-management facilities into your app, this is the crate you should use as a dependency, along with one or more keyring-compatible credential-stores.

## Usage

To use this crate in your project, include it in your `Cargo.toml`, either with or without the `sample` feature (which enables a credential store useful while testing). There are no default features.

In your application code, set your default credential store using `set_default_store` when you start up, and unset it with `unset_default_store` when you shut down. Use the `Entry::new` function to create a new keyring entry. The `new` function takes a service name and a user's name which together identify the entry.

Passwords (strings) or secrets (binary data) can be added to an entry using its `set_password` or `set_secret` methods, respectively. (These methods create or update an entry in your chosen credential store.) The password or secret can then be read back using the `get_password` or `get_secret` methods. The underlying credential (with its password/secret data) can be removed using the `delete_credential` method.

Here is a simple example application that uses the (included) mock credential store and does absolutely nothing:

```rust
use keyring_core::{mock, Entry, Result};

fn main() -> Result<()> {
    keyring_core::set_default_store(mock::Store::new()?);
    let entry = Entry::new("my-service", "my-name")?;
    entry.set_password("topS3cr3tP4$$w0rd")?;
    let password = entry.get_password()?;
    println!("My password is '{password}'");
    entry.delete_credential()?;
    keyring_core::unset_default_store();
    Ok(())
}
```

## Errors

Creating and operating on entries can yield an `Error` enum that classifies the error and, where relevant, includes underlying credential store errors or more information about what went wrong.

## Credential Stores

This crate comes with two cross-platform credential stores that can be used by clients who want to test their credential-store-independent logic. The first of these is a mock store with no persistence that allows mocking errors as well as successes. The other is a sample store with file-based persistence. Neither of these stores is secure or robust, so they should not be used in production. See the [developer docs](https://docs.rs/keyring-core/) for details.

## API changes

There are some changes in the keyring API relative to that in the [keyring crate v3](https://crates.io/crates/keyring/3.6.2), which this crate replaces. Both client and credential store developers should read the [keyring-core design document](https://github.com/open-source-cooperative/keyring-rs/wiki/Keyring-Core) to better understand the new API. Client developers will need to make changes to their code as outlined here. Credential store developers can use the `sample` credential store code as an example of how to structure their code. 

* In the older API, the default credential store was selected via feature at compilation time. In the new API, clients explicitly allocate a credential store at application startup, and then select that store as the default via `set_default_store`. (They should also release this store at application shutdown via `unset_default_store`.) The docs for each credential store contain allocation and other lifecycle details.
* The `Entry` API no longer exposes credential objects from an underlying store. As part of this change:
  * The `Entry::get_credential` call fails with a `NoEntry` error if there is no underlying credential object. If there is an underlying credential, it returns an `Entry` which _wraps_ that credential (see [the docs](https://docs.rs/keyring-core/) for details).
  * the `Ambiguous` error now returns a list of wrapper entries rather than a list of credentials. The `ambiguity` example in this crate has sample code that shows how to handle ambiguity without the use of credentials.

* The `Entry::new_with_target` API has been replaced by `Entry::new_with_modifiers`, where `target` is just one of the possible keys in the modifiers map (see [the docs](https://docs.rs/keyring-core/) for details). If you are using this API, be sure to check the docs for your credential stores to see whether they accept `target` as a modifier on entry creation.
* There is a new `Entry::search` API which takes a search specification and, if implemented by the underlying store, returns entries for all the matching credentials. Many thanks to @wiimmers for showing the way with his [keyring-search](https://crates.io/crates/keyring-search) crate. I am hoping he will integrate his search facilities into all the new credential stores.

## Changelog

See the [release history on GitHub](https://github.com/open-source-cooperative/keyring-core/releases). Since this crate contains code that was originally written as part of the [keyring crate](https://github.com/open-source-cooperative/keyring-rs/),  refer [to that crate’s release history](https://github.com/open-source-cooperative/keyring-rs/releases) for changes made prior to this crate’s creation.

## License

Licensed under either of

* Apache License, Version 2.0, ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
* MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
