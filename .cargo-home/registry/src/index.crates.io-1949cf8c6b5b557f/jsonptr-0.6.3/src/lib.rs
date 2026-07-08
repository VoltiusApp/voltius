// rustdoc + README hack: https://linebender.org/blog/doc-include
//! <style>.rustdoc-hidden { display: none; }</style>
//! [`Pointer`]: https://docs.rs/jsonptr/latest/jsonptr/struct.Pointer.html
//! [`Pointer::tokens`]: crate::Pointer::tokens
//! [`Pointer::components`]: crate::Pointer::components
//! [`Pointer::parse`]: crate::Pointer::parse
//! [`Pointer::resolve`]: crate::Pointer::resolve
//! [`Pointer::resolve_mut`]: crate::Pointer::resolve_mut
//! [`Pointer::assign`]: crate::Pointer::assign
//! [`Pointer::delete`]: crate::Pointer::delete
//! [`PointerBuf::parse`]: crate::PointerBuf::parse
//! [`PointerBuf`]: crate::PointerBuf
//! [`from_tokens`]: crate::PointerBuf::from_tokens
//! [`Token`]: crate::Token
//! [`Tokens`]: crate::Tokens
//! [`Components`]: crate::Components
//! [`Component`]: crate::Component
//! [`index`]: crate::index
//! [`tokens`]: crate::Pointer::tokens
//! [`components`]: crate::Pointer::components
//! [`resolve`]: crate::resolve
//! [`assign`]: crate::asign
//! [`delete`]: crate::delete
//! [`Resolve`]: crate::resolve::Resolve
//! [`ResolveMut`]: crate::resolve::ResolveMut
//! [`Assign`]: crate::assign::Assign
//! [`Delete`]: crate::delete::Delete
//! [`serde`]: https://docs.rs/serde/1.0/serde/index
//! [`serde_json`]: https://docs.rs/serde_json/1.0/serde_json/enum.Value.html
//! [`serde_json::Value`]: https://docs.rs/serde_json/1.0/serde_json/enum.Value.html
//! [`toml`]: https://docs.rs/toml/0.8/toml/enum.Value.html
//! [`toml::Value`]: https://docs.rs/toml/0.8/toml/enum.Value.html
//! [`Path`]: https://doc.rust-lang.org/std/path/struct.Path.html
//! [`PathBuf`]: https://doc.rust-lang.org/std/path/struct.PathBuf.html

#![doc = include_str!("../README.md")]
#![warn(missing_docs)]
#![deny(clippy::all, clippy::pedantic)]
#![cfg_attr(not(feature = "std"), no_std)]
#![allow(
    clippy::module_name_repetitions,
    clippy::into_iter_without_iter,
    clippy::needless_pass_by_value,
    clippy::expect_fun_call,
    clippy::must_use_candidate,
    clippy::similar_names
)]

#[cfg_attr(not(feature = "std"), macro_use)]
extern crate alloc;

#[cfg(feature = "assign")]
pub mod assign;
#[cfg(feature = "assign")]
pub use assign::Assign;

#[cfg(feature = "delete")]
pub mod delete;
#[cfg(feature = "delete")]
pub use delete::Delete;

#[cfg(feature = "resolve")]
pub mod resolve;
#[cfg(feature = "resolve")]
pub use resolve::{Resolve, ResolveMut};

mod pointer;
pub use pointer::{ParseError, Pointer, PointerBuf};

mod token;
pub use token::{InvalidEncodingError, Token, Tokens};

pub mod index;

mod component;
pub use component::{Component, Components};

#[cfg(test)]
mod arbitrary;
