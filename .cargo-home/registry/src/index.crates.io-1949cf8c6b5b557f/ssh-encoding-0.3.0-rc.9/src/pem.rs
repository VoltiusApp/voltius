//! PEM encoding support.

mod decode;
mod encode;
mod reader;
mod writer;

pub use self::{decode::DecodePem, encode::EncodePem};
pub use pem_rfc7468::{Error, LineEnding, PemLabel};

/// Line width used by the PEM encoding of OpenSSH documents.
const LINE_WIDTH: usize = 70;
