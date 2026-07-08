// Take a look at the license at the top of the repository in the LICENSE file.

#![doc = include_str!("../README.md")]
#![cfg_attr(docsrs, feature(doc_cfg))]

pub use ffi;
pub use glib;

#[macro_use]
mod rt;

#[allow(unused_imports)]
mod auto;

pub use crate::auto::*;

pub mod prelude;

pub use crate::attribute::Attribute;
pub use crate::attribute_set::AttributeSet;
pub use crate::text_rectangle::TextRectangle;

mod attribute;
mod attribute_set;
mod editable_text;
mod table;
mod text_rectangle;
