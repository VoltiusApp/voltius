//! Base64 support.

mod reader;
mod writer;

pub use self::{reader::Base64Reader, writer::Base64Writer};
pub use base64ct::{Base64, Base64Unpadded, Encoding, Error};
