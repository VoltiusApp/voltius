# SuppaFTP

<p align="center">
  <img src="/assets/images/suppaftp.svg" alt="logo" width="256" height="256" />
</p>
<p align="center">~ A super FTP/FTPS client library for Rust ~</p>
<p align="center">
  <a href="https://docs.rs/suppaftp" target="_blank">Documentation</a>
  ·
  <a href="https://crates.io/crates/suppaftp" target="_blank">Crates.io</a>
</p>

<p align="center">Developed by <a href="https://veeso.me/">veeso</a></p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"
    ><img
      src="https://img.shields.io/crates/l/suppaftp.svg"
      alt="License-Apache-2.0/MIT"
  /></a>
  <a href="https://github.com/veeso/suppaftp/stargazers"
    ><img
      src="https://img.shields.io/github/stars/veeso/suppaftp?style=flat"
      alt="Repo stars"
  /></a>
  <a href="https://crates.io/crates/suppaftp"
    ><img
      src="https://img.shields.io/crates/d/suppaftp.svg?logo=rust"
      alt="Downloads counter"
  /></a>
  <a href="https://crates.io/crates/suppaftp"
    ><img
      src="https://img.shields.io/crates/v/suppaftp.svg?logo=rust"
      alt="Latest version"
  /></a>
  <a href="https://ko-fi.com/veeso">
    <img
      src="https://img.shields.io/badge/donate-ko--fi-red"
      alt="Ko-fi"
  /></a>
  <a href="https://conventionalcommits.org">
    <img
      src="https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196?logo=conventionalcommits&logoColor=white"
      alt="conventional-commits"
  /></a>
</p>
<p align="center">
  <a href="https://github.com/veeso/suppaftp/actions"
    ><img
      src="https://github.com/veeso/suppaftp/actions/workflows/ci.yml/badge.svg"
      alt="CI"
  /></a>
  <a href="https://coveralls.io/github/veeso/suppaftp"
    ><img
      src="https://coveralls.io/repos/github/veeso/suppaftp/badge.svg"
      alt="Coveralls"
  /></a>
  <a href="https://docs.rs/suppaftp"
    ><img
      src="https://docs.rs/suppaftp/badge.svg"
      alt="Docs"
  /></a>
</p>

---

- [SuppaFTP](#suppaftp)
  - [Introduction 👋](#introduction-)
    - [Features ✨](#features-)
  - [Get started 🏁](#get-started-)
    - [Cargo features](#cargo-features)
      - [SSL/TLS Support](#ssltls-support)
      - [Async support](#async-support)
      - [Deprecated methods](#deprecated-methods)
      - [Logging](#logging)
    - [Examples 📚](#examples-)
      - [Ftp with TLS (native-tls)](#ftp-with-tls-native-tls)
      - [Ftp with TLS (rustls)](#ftp-with-tls-rustls)
      - [Going Async](#going-async)
  - [Built-in CLI client 🖥️](#built-in-cli-client-️)
  - [Changelog ⌛](#changelog-)
  - [License 📜](#license-)
    - [Contribution 🤝](#contribution-)

---

## Introduction 👋

SuppaFTP is a feature-rich FTP/FTPS client library for Rust, supporting both synchronous and asynchronous
programming. It aims to be a complete, reliable and well-tested implementation of the FTP protocol for Rust developers.

### Features ✨

- 🔒 **FTPS** support with your choice of TLS backend: [native-tls](https://crates.io/crates/native-tls) or
  [rustls](https://crates.io/crates/rustls)
- 🕙 First-class **sync and async** APIs, with [tokio](https://crates.io/crates/tokio) and
  [smol](https://crates.io/crates/smol) as async backends
- ⬇️ **Stream-based** transfers (e.g. `put_with_stream`, `retr`) for fine-grained control over data connections
- ↔️ Both **passive and active** transfer modes
- 🌟 Wide command coverage, including `ABOR`, `APPE`, `REST`, `EPSV` and `EPRT`
- 📑 Built-in parser for the **LIST** command output (POSIX and DOS formats) into structured `File` objects
- 👋 Helpers such as `get_welcome_msg` to access server greetings
- 🦀 **Pure Rust** with no mandatory C bindings (when using rustls)
- 📜 Implements [RFC 2428](https://www.rfc-editor.org/rfc/rfc2428.html) and
  [RFC 2389](https://www.rfc-editor.org/rfc/rfc2389)
- 🐛 Robust error handling and an extensive test suite with code coverage

---

## Get started 🏁

To get started, first add **suppaftp** to your dependencies:

```toml
suppaftp = "^8"
```

### Cargo features

These are all the possible features, by family

- **Sync FTP**:
  - `native-tls`: enable FTPS support using [native-tls](https://crates.io/crates/native-tls) as backend for TLS
  - `native-tls-vendored`: enable vendored FTPS support using [native-tls](https://crates.io/crates/native-tls)
  - `rustls-aws-lc-rs`: enable FTPS support using [rustls](https://crates.io/crates/rustls) with aws-lc-rs as TLS
    backend.
  - `rustls-ring`: enable FTPS support using [rustls](https://crates.io/crates/rustls) with ring as TLS backend.
- **Async FTP**:
  - **Smol**:
    - `smol`: enable async client using [smol](https://crates.io/crates/smol) as async backend
    - `smol-async-native-tls`: enable FTPS support
      using [async-native-tls](https://crates.io/crates/async-native-tls)
    - `smol-async-native-tls-vendored`: enable vendored FTPS support
      using [async-native-tls](https://crates.io/crates/async-native-tls)
    - `smol-rustls-aws-lc-rs`: enable FTPS support
      using [rustls](https://crates.io/crates/rustls) with aws-lc-rs as TLS backend.
    - `smol-rustls-ring`: enable FTPS support using [rustls](https://crates.io/crates/rustls)
      with ring as TLS backend.
  - **Tokio**:
    - `tokio`: enable async client using [tokio](https://crates.io/crates/tokio) as async backend
    - `tokio-async-native-tls`: enable FTPS support
      using [async-native-tls](https://crates.io/crates/async-native-tls)
    - `tokio-async-native-tls-vendored`: enable vendored FTPS support
      using [async-native-tls](https://crates.io/crates/async-native-tls)
    - `tokio-rustls-aws-lc-rs`: enable FTPS support
      using [rustls](https://crates.io/crates/rustls) with aws-lc-rs as TLS backend.
    - `tokio-rustls-ring`: enable FTPS support using [rustls](https://crates.io/crates/rustls)
      with ring as TLS backend.
- **Misc**:
  - `deprecated`: enable deprecated FTP/FTPS methods
  - `no-log`: disable logging

In more details:

#### SSL/TLS Support

If you want to enable **support for FTPS**, you must enable the `native-tls` or one of the `rustls` features in your
cargo dependencies, based on the TLS provider you prefer.

```toml
suppaftp = { version = "^8", features = ["native-tls"] }
# or
suppaftp = { version = "^8", features = ["rustls-aws-lc-rs"] }
```

> [!NOTE]
> 💡 If you don't know what to choose, `native-tls` should be preferred for compatibility reasons.\
> ❗ If you want to link libssl statically, enable feature `native-tls-vendored`

#### Async support

If you want to enable **async** support, you must enable either `smol` feature, to
use [smol](https://crates.io/crates/smol) or `tokio` feature, to use [tokio](https://crates.io/crates/tokio)
as backend, in your cargo dependencies.

```toml
suppaftp = { version = "^8", features = ["tokio"] }
```

> [!CAUTION]
> ⚠️ To enable both **native-tls** and **smol**, use the **smol-async-native-tls** feature ⚠️\
> ⚠️ To enable both **native-tls** and **tokio**, use the **tokio-async-native-tls** feature ⚠️\
> ⚠️ To enable both **rustls** and **smol**, use the **smol-rustls-aws-lc-rs** (or `-ring`) feature ⚠️\
> ⚠️ To enable both **rustls** and **tokio**, use the **tokio-rustls-aws-lc-rs** (or `-ring`) feature ⚠️\
> ❗ To link libssl statically with `smol`, enable feature `smol-async-native-tls-vendored`\
> ❗ To link libssl statically with `tokio`, enable feature `tokio-async-native-tls-vendored`

#### Deprecated methods

If you want to enable deprecated methods of FTPS, please enable the `deprecated` feature in your cargo dependencies.

This feature enables these methods:

- `connect_secure_implicit()`: used to connect via implicit FTPS

#### Logging

By default, the library will log if there is any `log` crate consumer on the user implementation.
Logging can be if preferred, disabled via the `no-log` feature.

### Examples 📚

```rust
use std::io::Cursor;
use std::str;

use suppaftp::FtpStream;

fn main() {
    // Create a connection to an FTP server and authenticate to it.
    let mut ftp_stream = FtpStream::connect("127.0.0.1:21").unwrap();
    let _ = ftp_stream.login("username", "password").unwrap();

    // Get the current directory that the client will be reading from and writing to.
    println!("Current directory: {}", ftp_stream.pwd().unwrap());

    // Change into a new directory, relative to the one we are currently in.
    let _ = ftp_stream.cwd("test_data").unwrap();

    // Retrieve (GET) a file from the FTP server in the current working directory.
    let data = ftp_stream.retr_as_buffer("ftpext-charter.txt").unwrap();
    println!(
        "Read file with contents\n{}\n",
        str::from_utf8(&data.into_inner()).unwrap()
    );

    // Store (PUT) a file from the client to the current working directory of the server.
    let mut reader = Cursor::new("Hello from the Rust \"ftp\" crate!".as_bytes());
    let _ = ftp_stream.put_file("greeting.txt", &mut reader);
    println!("Successfully wrote greeting.txt");

    // Terminate the connection to the server.
    let _ = ftp_stream.quit();
}
```

#### Ftp with TLS (native-tls)

```rust
use suppaftp::native_tls::TlsConnector;
use suppaftp::{NativeTlsConnector, NativeTlsFtpStream};

fn main() {
    let ftp_stream = NativeTlsFtpStream::connect("test.rebex.net:21").unwrap();
    // Switch to the secure mode
    let mut ftp_stream = ftp_stream
        .into_secure(
            NativeTlsConnector::from(TlsConnector::new().unwrap()),
            "test.rebex.net",
        )
        .unwrap();
    ftp_stream.login("demo", "password").unwrap();
    // Do other secret stuff
    assert!(ftp_stream.quit().is_ok());
}
```

#### Ftp with TLS (rustls)

You can also find and run this example in the `suppaftp/examples/` directory (
`cargo run --example rustls --features rustls`).

```rust
use std::sync::Arc;

use suppaftp::rustls::ClientConfig;
use suppaftp::{RustlsConnector, RustlsFtpStream, rustls};

fn main() {
    let root_store =
        rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    let config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();

    // Create a connection to an FTP server and authenticate to it.
    let mut ftp_stream = RustlsFtpStream::connect("test.rebex.net:21")
        .unwrap()
        .into_secure(RustlsConnector::from(Arc::new(config)), "test.rebex.net")
        .unwrap();

    // Terminate the connection to the server.
    let _ = ftp_stream.quit();
}
```

#### Going Async

```rust
use suppaftp::async_native_tls::TlsConnector;
use suppaftp::{AsyncNativeTlsConnector, AsyncNativeTlsFtpStream};

#[tokio::main]
async fn main() {
    let ftp_stream = AsyncNativeTlsFtpStream::connect("test.rebex.net:21")
        .await
        .unwrap();
    // Switch to the secure mode
    let mut ftp_stream = ftp_stream
        .into_secure(
            AsyncNativeTlsConnector::from(TlsConnector::new()),
            "test.rebex.net",
        )
        .await
        .unwrap();
    ftp_stream.login("demo", "password").await.unwrap();
    // Do other secret stuff
    assert!(ftp_stream.quit().await.is_ok());
}
```

## Built-in CLI client 🖥️

SuppaFTP comes also with a built-in command-line FTP client. This CLI application provides all the commands to interact
with a remote FTP server and supports FTPS too. You can also use it as a reference to implement your project. You can
find it in the `crates/suppaftp-cli/` directory.

You can simply install as any other rust application via **Cargo**:

```sh
cargo install suppaftp-cli
suppaftp --version
```

---

## Changelog ⌛

[View Changelog here](CHANGELOG.md)

---

## License 📜

Licensed under either of

- Apache License, Version 2.0, ([LICENSE-APACHE](LICENSE-APACHE) or <http://www.apache.org/licenses/LICENSE-2.0>)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or <http://opensource.org/licenses/MIT>)

at your option.

---

### Contribution 🤝

Unless you explicitly state otherwise, any contribution intentionally
submitted for inclusion in the work by you, as defined in the Apache-2.0
license, shall be dual licensed as above, without any additional terms or
conditions.

If you want to contribute to this project, please read the [Contributing guide](CONTRIBUTING.md) first 🙂.
