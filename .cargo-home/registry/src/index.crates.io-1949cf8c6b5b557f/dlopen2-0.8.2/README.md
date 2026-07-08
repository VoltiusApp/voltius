# dlopen2

[![CI](https://github.com/OpenByteDev/dlopen2/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenByteDev/dlopen2/actions/workflows/ci.yml)
[![crates.io](https://img.shields.io/crates/v/dlopen2.svg)](https://crates.io/crates/dlopen2)
[![Documentation](https://docs.rs/dlopen2/badge.svg)](https://docs.rs/dlopen2)
[![dependency status](https://deps.rs/repo/github/openbytedev/dlopen2/status.svg)](https://deps.rs/repo/github/openbytedev/dlopen2)
[![MIT](https://img.shields.io/crates/l/dlopen2.svg)](https://github.com/OpenByteDev/dlopen2/blob/master/LICENSE)

This is a fork of the original, now unmaintained [`dlopen`](https://github.com/szymonwieloch/rust-dlopen) with updated dependencies, bug fixes and some new features.

## Overview

This library is my effort to make use of dynamic link libraries in Rust simple.
Previously existing solutions were either unsafe, provided huge overhead of required writing too much code to achieve simple things.
I hope that this library will help you to quickly get what you need and avoid errors.

## Quick example

```rust
use dlopen2::wrapper::{Container, WrapperApi};

#[derive(WrapperApi)]
struct Api<'a> {
    example_rust_fun: fn(arg: i32) -> u32,
    example_c_fun: unsafe extern "C" fn(),
    example_reference: &'a mut i32,
    // A function or field may not always exist in the library.
    example_c_fun_option: Option<unsafe extern "C" fn()>,
    example_reference_option:  Option<&'a mut i32>,
}

fn main(){
    let mut cont: Container<Api> =
        unsafe { Container::load("libexample.so") }.expect("Could not open library or load symbols");
    cont.example_rust_fun(5);
    unsafe{ cont.example_c_fun() };
    *cont.example_reference_mut() = 5;
    
    // Optional functions return Some(result) if the function is present or None if absent.
    unsafe{ cont.example_c_fun_option() };
    // Optional fields are Some(value) if present and None if absent.
    if let Some(example_reference) = &mut cont.example_reference_option {
        *example_reference = 5;
    }
}
```

## Features

### Main features

* Supports majority of platforms and is platform independent.
* Is consistent with Rust error handling mechanism and makes making mistakes much more difficult.
* Is very lightweight. It mostly uses zero cost wrappers to create safer abstractions over platform API.
* Is thread safe.
* Is object-oriented programming friendly.
* Has a low-level API that provides full flexibility of using libraries.
* Has two high-level APIs that protect against dangling symbols - each in its own way.
* High level APIs support automatic loading of symbols into structures. You only need to define a
    structure that represents an API. The rest happens automatically and requires only minimal amount of code.
* Automatic loading of symbols helps you to follow the DRY paradigm.

## Comparison with other libraries

| Feature                            | dlopen2    | [libloading](https://github.com/nagisa/rust_libloading) | [sharedlib](https://github.com/Tyleo/sharedlib) |
|------------------------------------|------------|---------------------------------------------------------|-------------------------------------------------|
| Basic functionality                | Yes        | Yes        | Yes       |
| Multiplatform                      | Yes        | Yes        | Yes       |
| Dangling symbol prevention         | Yes        | Yes        | Yes       |
| Thread safety                      | Yes        | **Potential problem with thread-safety of `dlerror()` on some platforms like FreeBSD** | **No support for SetErrorMode (library may block the application on Windows)** |
| Loading of symbols into structures | Yes        | **No**     | **No** |
| Overhead                           | Minimal    | Minimal    | **Some overhead** |
| Low-level, unsafe API              | Yes        | Yes        | Yes       |
| Object-oriented friendly           | Yes        | **No**       | Yes     |
| Load from the program itself       | Yes        | **No**       | **No**  |
| Obtaining address information (dladdr) | Yes    |  **Unix only** | **No** |

## Safety

Please note that while Rust aims at being 100% safe language, it does not yet provide mechanisms that would allow me to create a 100% safe library, so I had to settle on 99%.
Also the nature of dynamic link libraries requires casting obtained pointers into types that are defined on the application side. And this cannot be safe. 
Having said that I still think that this library provides the best approach and greatest safety possible in Rust.

## Usage

Cargo.toml:

```toml
[dependencies]
dlopen2 = "0.8"
```

## Documentation

[Cargo documentation](https://docs.rs/dlopen2)

## License

This code is licensed under the [MIT](./LICENSE) license.

## Changelog

[GitHub changelog](https://github.com/OpenByteDev/dlopen2/releases)

## Acknowledgement

Special thanks to [Simonas Kazlauskas](https://github.com/nagisa) whose [libloading](https://github.com/nagisa/rust_libloading) became code base for my project.
