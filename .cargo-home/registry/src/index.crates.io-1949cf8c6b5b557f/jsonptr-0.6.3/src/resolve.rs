//! # Resolve values based on JSON [`Pointer`]s
//!
//! This module provides the [`Resolve`] and [`ResolveMut`] traits which are
//! implemented by types that can internally resolve a value based on a JSON
//! Pointer.
//!
//! This module is enabled by default with the `"resolve"` feature flag.
//!
//! ## Usage
//! [`Resolve`] and [`ResolveMut`] can be used directly or through the
//! [`resolve`](Pointer::resolve) and [`resolve_mut`](Pointer::resolve_mut)
//! methods on [`Pointer`] and [`PointerBuf`](crate::PointerBuf).
//!
//! ```rust
//! use jsonptr::{Pointer, Resolve, ResolveMut};
//! use serde_json::json;
//!
//! let ptr = Pointer::from_static("/foo/1");
//! let mut data = json!({"foo": ["bar", "baz"]});
//!
//! let value = ptr.resolve(&data).unwrap();
//! assert_eq!(value, &json!("baz"));
//!
//! let value = data.resolve_mut(ptr).unwrap();
//! assert_eq!(value, &json!("baz"));
//! ```
//!
//! ## Provided implementations
//!
//! | Lang  |     value type      | feature flag | Default |
//! | ----- |: ----------------- :|: ---------- :| ------- |
//! | JSON  | `serde_json::Value` |   `"json"`   |   ✓     |
//! | TOML  |    `toml::Value`    |   `"toml"`   |         |
//!
//!
use crate::{
    index::{OutOfBoundsError, ParseIndexError},
    Pointer, Token,
};

/*
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                                   Resolve                                    ║
║                                  ¯¯¯¯¯¯¯¯¯                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
*/

/// A trait implemented by types which can resolve a reference to a value type
/// from a path represented by a JSON [`Pointer`].
pub trait Resolve {
    /// The type of value that this implementation can operate on.
    type Value;

    /// Error associated with `Resolve`
    type Error;

    /// Resolve a reference to `Self::Value` based on the path in a [Pointer].
    ///
    /// ## Errors
    /// Returns a [`Self::Error`](Resolve::Error) if the [`Pointer`] can not
    /// be resolved.
    fn resolve(&self, ptr: &Pointer) -> Result<&Self::Value, Self::Error>;
}

/*
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                                 ResolveMut                                   ║
║                                ¯¯¯¯¯¯¯¯¯¯¯¯                                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
*/

/// A trait implemented by types which can resolve a mutable reference to a
/// value type from a path represented by a JSON [`Pointer`].
pub trait ResolveMut {
    /// The type of value that is being resolved.
    type Value;

    /// Error associated with `ResolveMut`
    type Error;

    /// Resolve a mutable reference to a `serde_json::Value` based on the path
    /// in a JSON Pointer.
    ///
    /// ## Errors
    /// Returns a [`Self::Error`](ResolveMut::Error) if the [`Pointer`] can not
    /// be resolved.
    fn resolve_mut(&mut self, ptr: &Pointer) -> Result<&mut Self::Value, Self::Error>;
}

/*
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                                 ResolveError                                 ║
║                                ¯¯¯¯¯¯¯¯¯¯¯¯¯¯                                ║
╚══════════════════════════════════════════════════════════════════════════════╝
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
*/

/// Indicates that the `Pointer` could not be resolved.
#[derive(Debug, PartialEq, Eq)]
pub enum ResolveError {
    /// `Pointer` could not be resolved because a `Token` for an array index is
    /// not a valid integer or dash (`"-"`).
    ///
    /// ## Example
    /// ```rust
    /// # use serde_json::json;
    /// # use jsonptr::Pointer;
    /// let data = json!({ "foo": ["bar"] });
    /// let ptr = Pointer::from_static("/foo/invalid");
    /// assert!(ptr.resolve(&data).unwrap_err().is_failed_to_parse_index());
    /// ```
    FailedToParseIndex {
        /// Offset of the partial pointer starting with the invalid index.
        offset: usize,
        /// The source `ParseIndexError`
        source: ParseIndexError,
    },

    /// `Pointer` could not be resolved due to an index being out of bounds
    /// within an array.
    ///
    /// ## Example
    /// ```rust
    /// # use serde_json::json;
    /// # use jsonptr::Pointer;
    /// let data = json!({ "foo": ["bar"] });
    /// let ptr = Pointer::from_static("/foo/1");
    /// assert!(ptr.resolve(&data).unwrap_err().is_out_of_bounds());
    OutOfBounds {
        /// Offset of the partial pointer starting with the invalid index.
        offset: usize,
        /// The source `OutOfBoundsError`
        source: OutOfBoundsError,
    },

    /// `Pointer` could not be resolved as a segment of the path was not found.
    ///
    /// ## Example
    /// ```rust
    /// # use serde_json::json;
    /// # use jsonptr::{Pointer};
    /// let mut data = json!({ "foo": "bar" });
    /// let ptr = Pointer::from_static("/bar");
    /// assert!(ptr.resolve(&data).unwrap_err().is_not_found());
    /// ```
    NotFound {
        /// Offset of the pointer starting with the `Token` which was not found.
        offset: usize,
    },

    /// `Pointer` could not be resolved as the path contains a scalar value
    /// before fully exhausting the path.
    ///
    /// ## Example
    /// ```rust
    /// # use serde_json::json;
    /// # use jsonptr::Pointer;
    /// let mut data = json!({ "foo": "bar" });
    /// let ptr = Pointer::from_static("/foo/unreachable");
    /// let err = ptr.resolve(&data).unwrap_err();
    /// assert!(err.is_unreachable());
    /// ```
    Unreachable {
        /// Offset of the pointer which was unreachable.
        offset: usize,
    },
}

impl ResolveError {
    /// Offset of the partial pointer starting with the token which caused the
    /// error.
    pub fn offset(&self) -> usize {
        match self {
            Self::FailedToParseIndex { offset, .. }
            | Self::OutOfBounds { offset, .. }
            | Self::NotFound { offset, .. }
            | Self::Unreachable { offset, .. } => *offset,
        }
    }

    /// Returns `true` if this error is `FailedToParseIndex`; otherwise returns
    /// `false`.
    pub fn is_unreachable(&self) -> bool {
        matches!(self, Self::Unreachable { .. })
    }

    /// Returns `true` if this error is `FailedToParseIndex`; otherwise returns
    /// `false`.
    pub fn is_not_found(&self) -> bool {
        matches!(self, Self::NotFound { .. })
    }

    /// Returns `true` if this error is `FailedToParseIndex`; otherwise returns
    /// `false`.
    pub fn is_out_of_bounds(&self) -> bool {
        matches!(self, Self::OutOfBounds { .. })
    }

    /// Returns `true` if this error is `FailedToParseIndex`; otherwise returns
    /// `false`.
    pub fn is_failed_to_parse_index(&self) -> bool {
        matches!(self, Self::FailedToParseIndex { .. })
    }
}

impl core::fmt::Display for ResolveError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::FailedToParseIndex { offset, .. } => {
                write!(f, "failed to parse index at offset {offset}")
            }
            Self::OutOfBounds { offset, .. } => {
                write!(f, "index at offset {offset} out of bounds")
            }
            Self::NotFound { offset, .. } => {
                write!(f, "pointer starting at offset {offset} not found")
            }
            Self::Unreachable { offset, .. } => {
                write!(f, "pointer starting at offset {offset} is unreachable")
            }
        }
    }
}

#[cfg(feature = "std")]
impl std::error::Error for ResolveError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::FailedToParseIndex { source, .. } => Some(source),
            Self::OutOfBounds { source, .. } => Some(source),
            _ => None,
        }
    }
}

/*
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                                  json impl                                   ║
║                                 ¯¯¯¯¯¯¯¯¯¯¯                                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
*/

#[cfg(feature = "json")]
mod json {
    use super::{parse_index, Pointer, Resolve, ResolveError, ResolveMut};
    use serde_json::Value;

    impl Resolve for Value {
        type Value = Value;
        type Error = ResolveError;

        fn resolve(&self, mut ptr: &Pointer) -> Result<&Value, Self::Error> {
            let mut offset = 0;
            let mut value = self;
            while let Some((token, rem)) = ptr.split_front() {
                let tok_len = token.encoded().len();
                ptr = rem;
                value = match value {
                    Value::Array(v) => {
                        let idx = token
                            .to_index()
                            .map_err(|source| ResolveError::FailedToParseIndex { offset, source })?
                            .for_len(v.len())
                            .map_err(|source| ResolveError::OutOfBounds { offset, source })?;
                        Ok(&v[idx])
                    }

                    Value::Object(v) => v
                        .get(token.decoded().as_ref())
                        .ok_or(ResolveError::NotFound { offset }),
                    // found a leaf node but the pointer hasn't been exhausted
                    _ => Err(ResolveError::Unreachable { offset }),
                }?;
                offset += 1 + tok_len;
            }
            Ok(value)
        }
    }

    impl ResolveMut for Value {
        type Value = Value;
        type Error = ResolveError;

        fn resolve_mut(&mut self, mut ptr: &Pointer) -> Result<&mut Value, ResolveError> {
            let mut offset = 0;
            let mut value = self;
            while let Some((token, rem)) = ptr.split_front() {
                let tok_len = token.encoded().len();
                ptr = rem;
                value = match value {
                    Value::Array(array) => {
                        let idx = parse_index(token, array.len(), offset)?;
                        Ok(&mut array[idx])
                    }
                    Value::Object(v) => v
                        .get_mut(token.decoded().as_ref())
                        .ok_or(ResolveError::NotFound { offset }),
                    // found a leaf node but the pointer hasn't been exhausted
                    _ => Err(ResolveError::Unreachable { offset }),
                }?;
                offset += 1 + tok_len;
            }
            Ok(value)
        }
    }
}
fn parse_index(token: Token, array_len: usize, offset: usize) -> Result<usize, ResolveError> {
    token
        .to_index()
        .map_err(|source| ResolveError::FailedToParseIndex { offset, source })?
        .for_len(array_len)
        .map_err(|source| ResolveError::OutOfBounds { offset, source })
}

/*
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                                  toml impl                                   ║
║                                 ¯¯¯¯¯¯¯¯¯¯¯                                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
*/

#[cfg(feature = "toml")]
mod toml {
    use super::{Resolve, ResolveError, ResolveMut};
    use crate::Pointer;
    use toml::Value;

    impl Resolve for Value {
        type Value = Value;
        type Error = ResolveError;

        fn resolve(&self, mut ptr: &Pointer) -> Result<&Value, Self::Error> {
            let mut offset = 0;
            let mut value = self;
            while let Some((token, rem)) = ptr.split_front() {
                let tok_len = token.encoded().len();
                ptr = rem;
                value = match value {
                    Value::Array(v) => {
                        let idx = token
                            .to_index()
                            .map_err(|source| ResolveError::FailedToParseIndex { offset, source })?
                            .for_len(v.len())
                            .map_err(|source| ResolveError::OutOfBounds { offset, source })?;
                        Ok(&v[idx])
                    }

                    Value::Table(v) => v
                        .get(token.decoded().as_ref())
                        .ok_or(ResolveError::NotFound { offset }),
                    // found a leaf node but the pointer hasn't been exhausted
                    _ => Err(ResolveError::Unreachable { offset }),
                }?;
                offset += 1 + tok_len;
            }
            Ok(value)
        }
    }

    impl ResolveMut for Value {
        type Value = Value;
        type Error = ResolveError;

        fn resolve_mut(&mut self, mut ptr: &Pointer) -> Result<&mut Value, ResolveError> {
            let mut offset = 0;
            let mut value = self;
            while let Some((token, rem)) = ptr.split_front() {
                let tok_len = token.encoded().len();
                ptr = rem;
                value = match value {
                    Value::Array(array) => {
                        let idx = token
                            .to_index()
                            .map_err(|source| ResolveError::FailedToParseIndex { offset, source })?
                            .for_len(array.len())
                            .map_err(|source| ResolveError::OutOfBounds { offset, source })?;
                        Ok(&mut array[idx])
                    }
                    Value::Table(v) => v
                        .get_mut(token.decoded().as_ref())
                        .ok_or(ResolveError::NotFound { offset }),
                    // found a leaf node but the pointer hasn't been exhausted
                    _ => Err(ResolveError::Unreachable { offset }),
                }?;
                offset += 1 + tok_len;
            }
            Ok(value)
        }
    }
}

/*
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                                    Tests                                     ║
║                                   ¯¯¯¯¯¯¯                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
*/

#[cfg(test)]
mod tests {
    use super::{Resolve, ResolveError, ResolveMut};
    use crate::{
        index::{OutOfBoundsError, ParseIndexError},
        Pointer,
    };
    use core::fmt;

    #[cfg(feature = "std")]
    #[test]
    fn resolve_error_source() {
        use std::error::Error;
        let err = ResolveError::FailedToParseIndex {
            offset: 0,
            source: ParseIndexError::InvalidInteger("invalid".parse::<usize>().unwrap_err()),
        };
        assert!(err.source().is_some());

        let err = ResolveError::OutOfBounds {
            offset: 0,
            source: OutOfBoundsError {
                index: 1,
                length: 0,
            },
        };
        assert!(err.source().is_some());

        let err = ResolveError::NotFound { offset: 0 };
        assert!(err.source().is_none());

        let err = ResolveError::Unreachable { offset: 0 };
        assert!(err.source().is_none());
    }

    #[test]
    fn resolve_error_display() {
        let err = ResolveError::FailedToParseIndex {
            offset: 0,
            source: ParseIndexError::InvalidInteger("invalid".parse::<usize>().unwrap_err()),
        };
        assert_eq!(format!("{err}"), "failed to parse index at offset 0");

        let err = ResolveError::OutOfBounds {
            offset: 0,
            source: OutOfBoundsError {
                index: 1,
                length: 0,
            },
        };
        assert_eq!(format!("{err}"), "index at offset 0 out of bounds");

        let err = ResolveError::NotFound { offset: 0 };

        assert_eq!(format!("{err}"), "pointer starting at offset 0 not found");

        let err = ResolveError::Unreachable { offset: 0 };
        assert_eq!(
            format!("{err}"),
            "pointer starting at offset 0 is unreachable"
        );
    }

    #[test]
    fn resolve_error_offset() {
        let err = ResolveError::FailedToParseIndex {
            offset: 0,
            source: ParseIndexError::InvalidInteger("invalid".parse::<usize>().unwrap_err()),
        };
        assert_eq!(err.offset(), 0);

        let err = ResolveError::OutOfBounds {
            offset: 0,
            source: OutOfBoundsError {
                index: 1,
                length: 0,
            },
        };
        assert_eq!(err.offset(), 0);

        let err = ResolveError::NotFound { offset: 0 };
        assert_eq!(err.offset(), 0);

        let err = ResolveError::Unreachable { offset: 0 };
        assert_eq!(err.offset(), 0);
    }

    #[test]
    fn resolve_error_is_unreachable() {
        let err = ResolveError::FailedToParseIndex {
            offset: 0,
            source: ParseIndexError::InvalidInteger("invalid".parse::<usize>().unwrap_err()),
        };
        assert!(!err.is_unreachable());

        let err = ResolveError::OutOfBounds {
            offset: 0,
            source: OutOfBoundsError {
                index: 1,
                length: 0,
            },
        };
        assert!(!err.is_unreachable());

        let err = ResolveError::NotFound { offset: 0 };
        assert!(!err.is_unreachable());

        let err = ResolveError::Unreachable { offset: 0 };
        assert!(err.is_unreachable());
    }

    #[test]
    fn resolve_error_is_not_found() {
        let err = ResolveError::FailedToParseIndex {
            offset: 0,
            source: ParseIndexError::InvalidInteger("invalid".parse::<usize>().unwrap_err()),
        };
        assert!(!err.is_not_found());

        let err = ResolveError::OutOfBounds {
            offset: 0,
            source: OutOfBoundsError {
                index: 1,
                length: 0,
            },
        };
        assert!(!err.is_not_found());

        let err = ResolveError::NotFound { offset: 0 };
        assert!(err.is_not_found());

        let err = ResolveError::Unreachable { offset: 0 };
        assert!(!err.is_not_found());
    }

    #[test]
    fn resolve_error_is_out_of_bounds() {
        let err = ResolveError::FailedToParseIndex {
            offset: 0,
            source: ParseIndexError::InvalidInteger("invalid".parse::<usize>().unwrap_err()),
        };
        assert!(!err.is_out_of_bounds());

        let err = ResolveError::OutOfBounds {
            offset: 0,
            source: OutOfBoundsError {
                index: 1,
                length: 0,
            },
        };
        assert!(err.is_out_of_bounds());

        let err = ResolveError::NotFound { offset: 0 };
        assert!(!err.is_out_of_bounds());

        let err = ResolveError::Unreachable { offset: 0 };
        assert!(!err.is_out_of_bounds());
    }

    #[test]
    fn resolve_error_is_failed_to_parse_index() {
        let err = ResolveError::FailedToParseIndex {
            offset: 0,
            source: ParseIndexError::InvalidInteger("invalid".parse::<usize>().unwrap_err()),
        };
        assert!(err.is_failed_to_parse_index());

        let err = ResolveError::OutOfBounds {
            offset: 0,
            source: OutOfBoundsError {
                index: 1,
                length: 0,
            },
        };
        assert!(!err.is_failed_to_parse_index());

        let err = ResolveError::NotFound { offset: 0 };
        assert!(!err.is_failed_to_parse_index());

        let err = ResolveError::Unreachable { offset: 0 };
        assert!(!err.is_failed_to_parse_index());
    }

    /*
    ╔═══════════════════════════════════════════════════╗
    ║                        json                       ║
    ╚═══════════════════════════════════════════════════╝
    */

    #[test]
    #[cfg(feature = "json")]
    fn resolve_json() {
        use serde_json::json;

        let data = &json!({
            "array": ["bar", "baz"],
            "object": {
                "object": {"baz": {"qux": "quux"}},
                "strings": ["zero", "one", "two"],
                "nothing": null,
                "bool": true,
                "objects": [{"field": "zero"}, {"field": "one"}, {"field": "two"}]
            },
            "": 0,
            "a/b": 1,
            "c%d": 2,
            "e^f": 3,
            "g|h": 4,
            "i\\j": 5,
            "k\"l": 6,
            " ": 7,
            "m~n": 8
        });
        // let data = &data;

        Test::all([
            // 0
            Test {
                ptr: "",
                data,
                expected: Ok(data),
            },
            // 1
            Test {
                ptr: "/array",
                data,
                expected: Ok(data.get("array").unwrap()), // ["bar", "baz"]
            },
            // 2
            Test {
                ptr: "/array/0",
                data,
                expected: Ok(data.get("array").unwrap().get(0).unwrap()), // "bar"
            },
            // 3
            Test {
                ptr: "/a~1b",
                data,
                expected: Ok(data.get("a/b").unwrap()), // 1
            },
            // 4
            Test {
                ptr: "/c%d",
                data,
                expected: Ok(data.get("c%d").unwrap()), // 2
            },
            // 5
            Test {
                ptr: "/e^f",
                data,
                expected: Ok(data.get("e^f").unwrap()), // 3
            },
            // 6
            Test {
                ptr: "/g|h",
                data,
                expected: Ok(data.get("g|h").unwrap()), // 4
            },
            // 7
            Test {
                ptr: "/i\\j",
                data,
                expected: Ok(data.get("i\\j").unwrap()), // 5
            },
            // 8
            Test {
                ptr: "/k\"l",
                data,
                expected: Ok(data.get("k\"l").unwrap()), // 6
            },
            // 9
            Test {
                ptr: "/ ",
                data,
                expected: Ok(data.get(" ").unwrap()), // 7
            },
            // 10
            Test {
                ptr: "/m~0n",
                data,
                expected: Ok(data.get("m~n").unwrap()), // 8
            },
            // 11
            Test {
                ptr: "/object/bool/unresolvable",
                data,
                expected: Err(ResolveError::Unreachable { offset: 12 }),
            },
            // 12
            Test {
                ptr: "/object/not_found",
                data,
                expected: Err(ResolveError::NotFound { offset: 7 }),
            },
        ]);
    }

    /*
    ╔═══════════════════════════════════════════════════╗
    ║                        toml                       ║
    ╚═══════════════════════════════════════════════════╝
    */
    #[test]
    #[cfg(feature = "toml")]
    fn resolve_toml() {
        use toml::{toml, Value};

        let data = &Value::Table(toml! {
            "array" = ["bar", "baz"]
            "object" = {
                "object" = {"baz" = {"qux" = "quux"}},
                "strings" = ["zero", "one", "two"],
                "bool" = true,
                "objects" = [{"field" = "zero"}, {"field" = "one"}, {"field" = "two"}]
            }
            "" = 0
            "a/b" = 1
            "c%d" = 2
            "e^f" = 3
            "g|h" = 4
            "i\\j" = 5
            "k\"l" = 6
            " " = 7
            "m~n" = 8
        });
        // let data = &data;

        Test::all([
            Test {
                ptr: "",
                data,
                expected: Ok(data),
            },
            Test {
                ptr: "/array",
                data,
                expected: Ok(data.get("array").unwrap()), // ["bar", "baz"]
            },
            Test {
                ptr: "/array/0",
                data,
                expected: Ok(data.get("array").unwrap().get(0).unwrap()), // "bar"
            },
            Test {
                ptr: "/a~1b",
                data,
                expected: Ok(data.get("a/b").unwrap()), // 1
            },
            Test {
                ptr: "/c%d",
                data,
                expected: Ok(data.get("c%d").unwrap()), // 2
            },
            Test {
                ptr: "/e^f",
                data,
                expected: Ok(data.get("e^f").unwrap()), // 3
            },
            Test {
                ptr: "/g|h",
                data,
                expected: Ok(data.get("g|h").unwrap()), // 4
            },
            Test {
                ptr: "/i\\j",
                data,
                expected: Ok(data.get("i\\j").unwrap()), // 5
            },
            Test {
                ptr: "/k\"l",
                data,
                expected: Ok(data.get("k\"l").unwrap()), // 6
            },
            Test {
                ptr: "/ ",
                data,
                expected: Ok(data.get(" ").unwrap()), // 7
            },
            Test {
                ptr: "/m~0n",
                data,
                expected: Ok(data.get("m~n").unwrap()), // 8
            },
            Test {
                ptr: "/object/bool/unresolvable",
                data,
                expected: Err(ResolveError::Unreachable { offset: 12 }),
            },
            Test {
                ptr: "/object/not_found",
                data,
                expected: Err(ResolveError::NotFound { offset: 7 }),
            },
        ]);
    }
    struct Test<'v, V> {
        ptr: &'static str,
        expected: Result<&'v V, ResolveError>,
        data: &'v V,
    }

    impl<'v, V> Test<'v, V>
    where
        V: Resolve<Value = V, Error = ResolveError>
            + ResolveMut<Value = V, Error = ResolveError>
            + Clone
            + PartialEq
            + fmt::Display
            + fmt::Debug,
    {
        fn all(tests: impl IntoIterator<Item = Test<'v, V>>) {
            tests.into_iter().enumerate().for_each(|(i, t)| t.run(i));
        }

        fn run(self, _i: usize) {
            _ = self;
            let Test {
                ptr,
                data,
                expected,
            } = self;
            let ptr = Pointer::from_static(ptr);

            // cloning the data & expected to make comparison easier
            let mut data = data.clone();
            let expected = expected.cloned();

            // testing Resolve
            let res = data.resolve(ptr).cloned();
            assert_eq!(&res, &expected);

            // testing ResolveMut
            let res = data.resolve_mut(ptr).cloned();
            assert_eq!(&res, &expected);
        }
    }
}
