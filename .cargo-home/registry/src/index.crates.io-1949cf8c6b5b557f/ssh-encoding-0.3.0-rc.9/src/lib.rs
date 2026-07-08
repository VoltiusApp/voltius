#![no_std]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![doc = include_str!("../README.md")]
#![doc(
    html_logo_url = "https://raw.githubusercontent.com/RustCrypto/media/6ee8e381/logo.svg",
    html_favicon_url = "https://raw.githubusercontent.com/RustCrypto/media/6ee8e381/logo.svg"
)]

//! ## Conventions used in this crate
//!
//! This crate uses the following type labels which are described in [RFC4251 § 5], and also lists
//! types with [`Decode`]/[`Encode`] trait impls which are compatible with this format:
//!
//! ### `byte`, `byte[n]`, `byte[]`: arbitrary 8-bit value (octet) or sequence thereof
//! #### [`Decode`]/[`Encode`] trait impls:
//! - `byte`: `u8`
//! - `byte[n]`: `[u8; N]`
//! - `byte[]`: `Vec<u8>`, `bytes::Bytes` (requires `bytes` crate feature)
//!
//! Fixed length data is sometimes represented as an array of bytes, written
//! `byte[n]` where `n` is the number of bytes in the array.
//!
//! `byte[]` is a newer convention from OpenSSH for describing arbitrary
//! length bytestrings (similar to `string`, see below) but identifies data
//! which is inherently binary in nature, as opposed to text.
//!
//!
//! ### `boolean`: boolean value stored as a single byte
//! #### [`Decode`]/[`Encode`] trait impls: `bool`
//!
//! The value 0 represents FALSE, and the value 1 represents TRUE.  All non-zero
//! values MUST be interpreted as TRUE; however, applications MUST NOT
//! store values other than 0 and 1.
//!
//! ### `uint32`: 32-bit unsigned integer
//! #### [`Decode`]/[`Encode`] trait impls: `u32`, `usize`
//!
//! Stored as four bytes in the order of decreasing significance (network byte order).
//!
//! For example: the value `699921578` (`0x29b7f4aa`) is stored as
//! `29 b7 f4 aa`.
//!
//! ### `uint64`: 64-bit unsigned integer
//! #### [`Decode`]/[`Encode`] trait impls: `u64`
//!
//! Stored as eight bytes in the order of decreasing significance (network byte order).
//!
//! ### `string`: arbitrary length *binary* string
//! #### [`Decode`]/[`Encode`] trait impls: `Vec<u8>`, `String`, `bytes::Bytes` (requires `bytes` crate feature)
//!
//! *NOTE: `string` is effectively equivalent to `byte[]`, however the latter is not defined in
//! [RFC4251] and so trait impls in this crate for bytestring types like `[u8; N]` and `Vec<u8>`
//! are described as being impls of `string`*.
//!
//! Strings are allowed to contain arbitrary binary data, including null characters and 8-bit
//! characters.
//!
//! They are stored as a `uint32` containing its length (number of bytes that follow) and
//! zero (= empty string) or more bytes that are the value of the string.  Terminating null
//! characters are not used.
//!
//! Strings are also used to store text.  In that case, US-ASCII is used for internal names, and
//! ISO-10646 UTF-8 for text that might be displayed to the user.
//!
//! The terminating null character SHOULD  NOT normally be stored in the string.
//!
//! For example: the US-ASCII string "testing" is represented as `00 00 00 07 t e s t i n g`.
//! The UTF-8 mapping does not alter the encoding of US-ASCII characters.
//!
//! ### `mpint`: multiple precision integers in two's complement format
//! #### [`Decode`]/[`Encode`] trait impls: `Mpint`
//!
//! Stored as a byte string, 8 bits per byte, MSB first (a.k.a. big endian).
//!
//! Negative numbers have the value 1 as the most significant bit of the first byte of
//! the data partition.  If the most significant bit would be set for
//! a positive number, the number MUST be preceded by a zero byte.
//! Unnecessary leading bytes with the value 0 or 255 MUST NOT be
//! included.  The value zero MUST be stored as a string with zero
//! bytes of data.
//!
//! By convention, a number that is used in modular computations in
//! `Z_n` SHOULD be represented in the range `0 <= x < n`.
//!
//! #### Examples:
//!
//! value (hex)        | representation (hex)
//! -------------------|---------------------
//! `0`                | `00 00 00 00`
//! `9a378f9b2e332a7`  | `00 00 00 08 09 a3 78 f9 b2 e3 32 a7`
//! `80`               | `00 00 00 02 00 80`
//! `-1234`            | `00 00 00 02 ed cc`
//! `-deadbeef`        | `00 00 00 05 ff 21 52 41 11`
//!
//! ### `name-list`: string containing a comma-separated list of names
//! #### [`Decode`]/[`Encode`] trait impls: `Vec<String>`
//!
//! A `name-list` is represented as a `uint32` containing its length
//! (number of bytes that follow) followed by a comma-separated list of zero or more
//! names.  A name MUST have a non-zero length, and it MUST NOT
//! contain a comma (",").
//!
//! As this is a list of names, all the elements contained are names and MUST be in US-ASCII.
//!
//! Context may impose additional restrictions on the names. For example,
//! the names in a name-list may have to be a list of valid algorithm
//! identifiers (see Section 6 below), or a list of [RFC3066] language
//! tags.  The order of the names in a name-list may or may not be
//! significant.  Again, this depends on the context in which the list
//! is used.
//!
//! Terminating null characters MUST NOT be used, neither
//! for the individual names, nor for the list as a whole.
//!
//! #### Examples:
//!
//! value                      | representation (hex)
//! ---------------------------|---------------------
//! `()`, the empty name-list  | `00 00 00 00`
//! `("zlib")`                 | `00 00 00 04 7a 6c 69 62`
//! `("zlib,none")`            | `00 00 00 09 7a 6c 69 62 2c 6e 6f 6e 65`
//!
//! [RFC3066]: https://datatracker.ietf.org/doc/html/rfc3066
//! [RFC4251]: https://datatracker.ietf.org/doc/html/rfc4251
//! [RFC4251 § 5]: https://datatracker.ietf.org/doc/html/rfc4251#section-5
//!
//! ## Deriving [`Decode`] and [`Encode`]
//!
//! The traits [`Decode`] and [`Encode`] can be derived for any struct or enum where all its fields
//! implement [`Decode`] and [`Encode`] respectively.
//!
//! To use this functionality, enable the `derive` crate feature for `ssh-encoding`.
//!
//! ### Example
//!
//! Here is an example of how you could define a handful of the SSH message types:
//!
#![cfg_attr(all(feature = "alloc", feature = "derive"), doc = "```")]
#![cfg_attr(not(all(feature = "alloc", feature = "derive")), doc = "```ignore")]
//! use ssh_encoding::{Decode, Encode};
//!
//! #[derive(Debug, PartialEq, Encode, Decode)]
//! #[repr(u8)]
//! enum Message {
//!     Disconnect {
//!         reason_code: u32,
//!         description: String,
//!         language_tag: String,
//!     } = 1,
//!     EcdhInit {
//!         client_public_key: Vec<u8>,
//!     } = 30,
//!     EcdhReply {
//!         host_key: HostKey,
//!         server_public_key: Vec<u8>,
//!         #[ssh(length_prefixed)]
//!         host_signature: HostSignature,
//!     } = 31,
//! }
//!
//! #[derive(Debug, PartialEq, Encode, Decode)]
//! #[ssh(length_prefixed)]
//! struct HostKey {
//!     key_type: String,
//!     ecdsa_curve_identifier: String,
//!     ecdsa_public_key: Vec<u8>,
//! }
//!
//! #[derive(Debug, PartialEq, Encode, Decode)]
//! struct HostSignature {
//!     signature_type: String,
//!     signature: Vec<u8>,
//! }
//!
//! let message = Message::EcdhReply {
//!     host_key: HostKey {
//!         key_type: "ecdsa-sha2-nistp256".into(),
//!         ecdsa_curve_identifier: "nistp256".into(),
//!         ecdsa_public_key: vec![0x01, 0x02, 0x03],
//!     },
//!     server_public_key: vec![0x04, 0x05, 0x06],
//!     host_signature: HostSignature {
//!         signature_type: "ecdsa-sha2-nistp256".into(),
//!         signature: vec![0x07, 0x08, 0x09],
//!     },
//! };
//!
//! let encoded = message.encode_vec().unwrap();
//! assert_eq!(&encoded[..13], &[31, 0, 0, 0, 42, 0, 0, 0, 19, 101, 99, 100, 115]);
//! let decoded = Message::decode(&mut &encoded[..]).unwrap();
//! assert_eq!(message, decoded);
//! ```

#[cfg(feature = "alloc")]
#[macro_use]
extern crate alloc;

mod checked;
mod decode;
mod encode;
mod error;
mod label;
#[cfg(feature = "alloc")]
mod mpint;
#[macro_use]
mod reader;
mod writer;

#[cfg(feature = "base64")]
pub mod base64;
#[cfg(feature = "pem")]
pub mod pem;

pub use crate::{
    checked::CheckedSum,
    decode::Decode,
    encode::Encode,
    error::{Error, Result},
    label::{Label, LabelError},
    reader::Reader,
    writer::Writer,
};

#[cfg(feature = "alloc")]
pub use crate::mpint::Mpint;

#[cfg(feature = "base64")]
pub use crate::{base64::Base64Reader, base64::Base64Writer};

#[cfg(feature = "bigint")]
pub use bigint;

#[cfg(feature = "bytes")]
pub use bytes;

#[cfg(feature = "digest")]
pub use crate::writer::DigestWriter;
#[cfg(feature = "digest")]
pub use digest;

#[cfg(feature = "pem")]
pub use crate::pem::{DecodePem, EncodePem};

#[cfg(feature = "derive")]
pub use ssh_derive::{Decode, Encode};

#[cfg(all(doc, feature = "alloc"))]
use alloc::vec::Vec;

#[cfg(feature = "bigint")]
pub use bigint::BoxedUint as Uint;
