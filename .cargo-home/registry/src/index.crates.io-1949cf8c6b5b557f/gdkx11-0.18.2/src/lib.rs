// Take a look at the license at the top of the repository in the LICENSE file.

#![cfg_attr(docsrs, feature(doc_cfg))]
#![allow(clippy::upper_case_acronyms)]
#![doc = include_str!("../README.md")]

pub use ffi;
pub use gdk;
pub use gio;
pub use glib;
pub use x11;

#[macro_use]
mod rt;
#[allow(unused_imports)]
mod auto;

pub mod builders;

pub use crate::auto::*;
