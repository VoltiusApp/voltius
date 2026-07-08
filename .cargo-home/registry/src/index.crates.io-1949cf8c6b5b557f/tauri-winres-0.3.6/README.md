# tauri-winres

A simple library to facilitate adding [Resources](<https://en.wikipedia.org/wiki/Resource_(Windows)>) (metainformation and icons) to [Portable Executables](https://en.wikipedia.org/wiki/Portable_Executable).

Note: `tauri-winres` is a fork of [winres](https://github.com/mxre/winres) which no longer works on Rust 1.61 or higher and has been [left unmaintained](https://github.com/mxre/winres/issues/40). This fork completely replaced the resource compiler implementation with the awesome [embed-resource](https://github.com/nabijaczleweli/rust-embed-resource) crate for better cross-platform compilation support. This fork was primarily updated and modified for use in [Tauri](https://github.com/tauri-apps/tauri). For a more general-purpose-like fork, which currently sticks closer to upstream, we suggest to also take a look at [winresource](https://github.com/BenjaminRi/winresource).

[Documentation](https://docs.rs/tauri-winres/)

## Toolkit

Before we begin you need to have the appropriate tools installed.

- `rc.exe` from the [Windows SDK]
- `windres.exe` and `ar.exe` from [minGW64]

[windows sdk]: https://developer.microsoft.com/en-us/windows/downloads/windows-10-sdk
[mingw64]: http://mingw-w64.org

If you are using Rust with the MSVC ABI you will need the Windows SDK and for the GNU ABI you'll need minGW64.

The Windows SDK can generally be found in the registry, but minGW64 must be in the $PATH environment.

## Using tauri-winres

First, you will need to add a build script to your crate (`build.rs`) by adding it to your crate's `Cargo.toml` file:

```toml
[package]
#...
build = "build.rs"

[build-dependencies]
tauri-winres = "0.1"
```

Next, you have to write a build script. A short example is shown below.

```rust
// build.rs

fn main() {
  if std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "windows" {
    let mut res = tauri_winres::WindowsResource::new();
    res.set_icon("test.ico");
    res.compile().unwrap();
  }
}
```

That's it. The file `test.ico` should be located in the same directory as `build.rs`. Metainformation (like program version and description) is taken from `Cargo.toml`'s `[package]` section.

Note that support for using this crate on non-Windows platforms is experimental. It is recommended to only use `tauri-winres` on Windows hosts, by using `cfg` as a directive to avoid building `tauri-winres` on unix platforms alltogether.

```toml
[package]
#...
build = "build.rs"

[target.'cfg(windows)'.build-dependencies]
tauri-winres = "0.1"
```

Next, you have to write a build script. A short example is shown below.

```rust
// build.rs

#[cfg(windows)]
fn main() {
    let mut res = tauri_winres::WindowsResource::new();
    res.set_icon("test.ico");
    res.compile().unwrap();
}

#[cfg(unix)]
fn main() {}
```

## Additional Options

For added convenience, `tauri-winres` parses `Cargo.toml` for a `package.metadata.tauri-winres` section:

```toml
[package.metadata.tauri-winres]
OriginalFilename = "PROGRAM.EXE"
LegalCopyright = "Copyright © 2016"
#...
```

This section may contain arbitrary string key-value pairs, to be included in the version info section of the executable/library file.

The following keys have special meanings and will be shown in the file properties of the Windows Explorer:

`FileDescription`, `ProductName`, `ProductVersion`, `OriginalFilename` and `LegalCopyright`

See [MSDN] for more details on the version info section of executables/libraries.

[msdn]: https://msdn.microsoft.com/en-us/library/windows/desktop/aa381058.aspx

## About this project

The [original author](https://github.com/mxre) and maintainers use this crate for their personal projects and although it has been tested in that context, we have no idea if the behaviour is the same everywhere.

To be brief, we are very much reliant on your bug reports and feature suggestions to make this crate better.
