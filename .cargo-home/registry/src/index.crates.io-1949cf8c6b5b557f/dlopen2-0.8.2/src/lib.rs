/*!

Library for opening and working with dynamic link libraries (also known as shared object).

# Overview

This library is an effort to make use of dynamic link libraries in Rust simple.
Previously existing solutions were either unsafe, provided huge overhead of required writing too much code to achieve simple things.
I hope that this library will help you to quickly get what you need and avoid errors.

# Quick example

```no_run
use dlopen2::wrapper::{Container, WrapperApi};

#[derive(WrapperApi)]
struct Api<'a> {
    example_rust_fun: fn(arg: i32) -> u32,
    example_c_fun: unsafe extern "C" fn(),
    example_reference: &'a mut i32,
    // A function or field may not always exist in the library.
    example_c_fun_option: Option<unsafe extern "C" fn()>,
    example_reference_option: Option<&'a mut i32>,
}

fn main() {
    let mut cont: Container<Api> =
        unsafe { Container::load("libexample.so") }.expect("Could not open library or load symbols");
    cont.example_rust_fun(5);
    unsafe { cont.example_c_fun() };
    *cont.example_reference_mut() = 5;

    // Optional functions return Some(result) if the function is present or None if absent.
    unsafe { cont.example_c_fun_option() };
    // Optional fields are Some(value) if present and None if absent.
    if let Some(example_reference) = cont.example_reference_option() {
        *example_reference = 5;
    }
}
```

# Features

## Main features

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
| Obtaining address information (dladdr) | Yes    | **Unix only** | **No** |

## Safety

Please note that while Rust aims at being 100% safe language, it does not yet provide mechanisms that would allow me to create a 100% safe library, so I had to settle on 99%.
Also the nature of dynamic link libraries requires casting obtained pointers into types that are defined on the application side. And this cannot be safe.
Having said that I still think that this library provides the best approach and greatest safety possible in Rust.

# Usage:

Cargo.toml:

```toml
[dependencies]
dlopen2 = "0.8"
```

# Documentation

[Cargo documentation](https://docs.rs/dlopen2)

[Examples](https://github.com/OpenByteDev/dlopen2/tree/master/dlopen2/examples)

[Changelog](https://github.com/OpenByteDev/dlopen2/releases)

# License
This code is licensed under the [MIT](https://github.com/OpenByteDev/dlopen2/blob/master/LICENSE) license.

# Acknowledgement

Special thanks to [Simonas Kazlauskas](https://github.com/nagisa) whose [libloading](https://github.com/nagisa/rust_libloading) became code base for my project.

# Comparison of APIs:

* [**raw**](./raw/index.html) - a low-level API. It is mainly intended to give you full flexibility
  if you decide to create you own custom solution for handling dynamic link libraries.
  For typical operations you probably should use one of high-level APIs.

* [**symbor**](./symbor/index.html) - a high-level API. It prevents dangling symbols by creating
  zero cost structural wrappers around symbols obtained from the library. These wrappers use
  Rust borrowing mechanism to make sure that the library will never get released before obtained
  symbols.

* [**wrapper**](./wrapper/index.html) - a high-level API. It prevents dangling symbols by creating
  zero cost functional wrappers around symbols obtained from the library. These wrappers prevent
  accidental copying of raw symbols from library API. Dangling symbols are prevented by keeping
  library and its API in one structure - this makes sure that symbols and library are released
  together.

Additionally both high-level APIs provide a way to automatically load symbols into a structure using
Rust reflection mechanism. Decision which API should be used is a matter of taste - please check
documentation of both of them and use the one that you prefer.
At the moment none seems to have any reasonable advantage over the other.

*/

#![allow(
    clippy::missing_safety_doc,
    clippy::needless_doctest_main,
    unused_unsafe
)]
#![cfg_attr(feature = "doc_cfg", feature(doc_cfg))]

mod err;
pub mod raw;
#[cfg(feature = "symbor")]
#[cfg_attr(feature = "doc_cfg", doc(cfg(feature = "symbor")))]
pub mod symbor;
pub mod utils;
#[cfg(feature = "wrapper")]
#[cfg_attr(feature = "doc_cfg", doc(cfg(feature = "wrapper")))]
pub mod wrapper;
pub use err::Error;
