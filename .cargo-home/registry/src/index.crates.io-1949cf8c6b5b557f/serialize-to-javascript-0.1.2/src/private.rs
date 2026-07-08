use std::convert::TryFrom;

use serde_json::value::RawValue;

use crate::{Options, Serialized};

pub use serde::Serialize;

/// Prevent (hidden, not impossible) implementation of crate traits outside this crate.
pub trait Sealed {}

/// A [`Serialize`] value that has yet to be serialized.
pub struct NotYetSerialized<'a, T: Serialize>(pub &'a T);

impl<'a, T: Serialize> From<&'a T> for NotYetSerialized<'a, T> {
    fn from(input: &'a T) -> Self {
        Self(input)
    }
}

/// A [`Serialize`] value that has been serialized exactly once.
pub struct SerializedOnce(Box<RawValue>);

impl<'a, T: Serialize> TryFrom<NotYetSerialized<'a, T>> for SerializedOnce {
    type Error = serde_json::Error;

    fn try_from(value: NotYetSerialized<'_, T>) -> Result<Self, Self::Error> {
        serde_json::to_string(value.0)
            .and_then(RawValue::from_string)
            .map(Self)
    }
}

impl SerializedOnce {
    /// Transform the serialized data into a valid JavaScript string.
    pub fn into_javascript_string_literal(self, options: &Options) -> Serialized {
        Serialized::new(&self.0, options)
    }
}

impl Serialized {
    /// Create [`Serialized`] from an existing [`String`] without serializing anything.
    ///
    /// # Safety
    ///
    /// This performs **NO** serialization of the input, even though [`Serialized`] implies the
    /// content has been serialized.
    ///
    /// This is intended for use from [`serialize_to_javascript_impl`] to put content from
    /// templates (which have multiple items that are serialized) into a single [`Serialized`] item
    /// after properly performing serialization. Think of this like [`String::get_utf8_unchecked`].
    #[doc(hidden)]
    pub unsafe fn from_string_unchecked(string: String) -> Self {
        Self(string)
    }
}
