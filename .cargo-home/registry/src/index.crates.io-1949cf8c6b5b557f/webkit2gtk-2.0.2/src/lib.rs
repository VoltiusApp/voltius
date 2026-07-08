#![allow(deprecated)]
#![doc = include_str!("../README.md")]
#![cfg_attr(docsrs, feature(doc_cfg))]

pub use ffi;

// Re-export gtk dependencies
pub use gio;
pub use glib;

pub use glib::Error;

#[cfg_attr(feature = "cargo-clippy", allow(too_many_arguments))]
#[cfg_attr(feature = "cargo-clippy", allow(useless_transmute))]
#[macro_use]
mod rt;

#[allow(unused_imports)]
mod auto;
// mod credential;
// mod javascript_result;
// mod web_context;
mod web_view;

#[cfg(any(feature = "v2_16", docsrs))]
#[cfg_attr(docsrs, doc(cfg(feature = "v2_16")))]
mod website_data_manager;

// pub use credential::*;
// pub use javascript_result::*;
// pub use web_context::*;
pub use web_view::*;

#[cfg(any(feature = "v2_16", docsrs))]
#[cfg_attr(docsrs, doc(cfg(feature = "v2_16")))]
pub use website_data_manager::*;

pub use crate::auto::builders::*;
pub use crate::auto::traits::*;
pub use crate::auto::*;
