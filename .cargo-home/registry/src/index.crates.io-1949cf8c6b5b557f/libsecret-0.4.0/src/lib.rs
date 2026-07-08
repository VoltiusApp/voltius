#![cfg_attr(feature = "dox", feature(doc_cfg))]
//! # Rust Libsecret bindings
//!
//! This library contains safe Rust bindings for
//! [Libsecret](https://gitlab.gnome.org/GNOME/libsecret/), a library that
//! offers access to the Secret Service API.
//!
//! See also
//!
//! - [gtk-rs project overview](https://gtk-rs.org/)
//!
//! ## Usage
//!
//! You can add libsecret by adding it in your `Cargo.toml` file:
//!
//! ```toml
//! [dependencies.secret]
//! package = "libsecret"
//! version = "0.x.y"
//! ```
//!
//! ### Define a password schema
//!
//! Each stored password has a set of attributes which are later used to lookup
//! the password. The names and types of the attributes are defined in a schema.
//! The schema is usually defined once globally. Here’s how to define a schema:
//!
//! ```no_run
//! let mut attributes = std::collections::HashMap::new();
//! attributes.insert("number", libsecret::SchemaAttributeType::Integer);
//! attributes.insert("string", libsecret::SchemaAttributeType::String);
//! attributes.insert("even", libsecret::SchemaAttributeType::Boolean);
//!
//! let schema = libsecret::Schema::new("some.app.Id", libsecret::SchemaFlags::NONE, attributes);
//! ```
//!
//! ### Store a password
//!
//! Each stored password has a set of attributes which are later used to lookup
//! the password. The attributes should not contain secrets, as they are not
//! stored in an encrypted fashion.
//!
//! This first example stores a password asynchronously, and is appropriate for GUI applications so that the UI does not block.
//!
//! ```no_run
//! let mut attributes = std::collections::HashMap::new();
//! attributes.insert("number", "8");
//! attributes.insert("string", "eight");
//! attributes.insert("even", "true");
//!
//! let collection = libsecret::COLLECTION_DEFAULT;
//! libsecret::password_store_future(Some(&schema), attributes, Some(&collection), "The Label", "the password").await?;
//! ```
//!
//! ### Lookup a password
//!
//! Each stored password has a set of attributes which are used to lookup the
//! password. If multiple passwords match the lookup attributes, then the one
//! stored most recently is returned.
//!
//! This first example looks up a password asynchronously, and is appropriate
//! for GUI applications so that the UI does not block.
//!
//! ```no_run
//! let mut attributes = std::collections::HashMap::new();
//! attributes.insert("number", "8");
//! attributes.insert("even", "true");
//!
//! let password = libsecret::password_lookup_future(Some(&schema), attributes).await?;
//! ```
//! ### Remove a password
//!
//! Each stored password has a set of attributes which are used to find which
//! password to remove. If multiple passwords match the attributes, then the one
//! stored most recently is removed.
//!
//! This first example removes a password asynchronously, and is appropriate for
//! GUI applications so that the UI does not block.
//!
//! ```no_run
//! let mut attributes = std::collections::HashMap::new();
//! attributes.insert("number", "8");
//! attributes.insert("even", "true");
//!
//! libsecret::password_clear_future(Some(&schema), attributes).await?;
//! ```
#[allow(unused_imports)]
mod auto;

pub use auto::functions::*;
pub use auto::*;
pub use functions::*;

mod collection;
mod enums;
mod functions;
mod hashtable;
#[allow(clippy::too_many_arguments)]
mod item;
mod prompt;
#[cfg(any(feature = "v0_19", feature = "dox"))]
#[cfg_attr(feature = "dox", doc(cfg(feature = "v0_19")))]
mod retrievable;
mod schema;
mod schema_attribute;
#[allow(clippy::type_complexity)]
#[allow(clippy::too_many_arguments)]
mod service;
mod value;

pub use value::Value;

pub use ffi;

pub mod prelude {
    pub use super::auto::traits::*;
    pub use super::collection::CollectionExtManual;
    pub use super::prompt::PromptExtManual;
    #[cfg(any(feature = "v0_19", feature = "dox"))]
    #[cfg_attr(feature = "dox", doc(cfg(feature = "v0_19")))]
    pub use super::retrievable::RetrievableExtManual;
    pub use super::service::ServiceExtManual;
}
