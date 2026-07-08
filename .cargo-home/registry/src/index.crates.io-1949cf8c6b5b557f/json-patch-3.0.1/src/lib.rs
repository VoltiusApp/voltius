//! A [JSON Patch (RFC 6902)](https://tools.ietf.org/html/rfc6902) and
//! [JSON Merge Patch (RFC 7396)](https://tools.ietf.org/html/rfc7396) implementation for Rust.
//!
//! # Usage
//!
//! Add this to your *Cargo.toml*:
//! ```toml
//! [dependencies]
//! json-patch = "*"
//! ```
//!
//! # Examples
//! Create and patch document using JSON Patch:
//!
//! ```rust
//! #[macro_use]
//! use json_patch::{Patch, patch};
//! use serde_json::{from_value, json};
//!
//! # pub fn main() {
//! let mut doc = json!([
//!     { "name": "Andrew" },
//!     { "name": "Maxim" }
//! ]);
//!
//! let p: Patch = from_value(json!([
//!   { "op": "test", "path": "/0/name", "value": "Andrew" },
//!   { "op": "add", "path": "/0/happy", "value": true }
//! ])).unwrap();
//!
//! patch(&mut doc, &p).unwrap();
//! assert_eq!(doc, json!([
//!   { "name": "Andrew", "happy": true },
//!   { "name": "Maxim" }
//! ]));
//!
//! # }
//! ```
//!
//! Create and patch document using JSON Merge Patch:
//!
//! ```rust
//! #[macro_use]
//! use json_patch::merge;
//! use serde_json::json;
//!
//! # pub fn main() {
//! let mut doc = json!({
//!   "title": "Goodbye!",
//!   "author" : {
//!     "givenName" : "John",
//!     "familyName" : "Doe"
//!   },
//!   "tags":[ "example", "sample" ],
//!   "content": "This will be unchanged"
//! });
//!
//! let patch = json!({
//!   "title": "Hello!",
//!   "phoneNumber": "+01-123-456-7890",
//!   "author": {
//!     "familyName": null
//!   },
//!   "tags": [ "example" ]
//! });
//!
//! merge(&mut doc, &patch);
//! assert_eq!(doc, json!({
//!   "title": "Hello!",
//!   "author" : {
//!     "givenName" : "John"
//!   },
//!   "tags": [ "example" ],
//!   "content": "This will be unchanged",
//!   "phoneNumber": "+01-123-456-7890"
//! }));
//! # }
//! ```
#![warn(missing_docs)]

use jsonptr::{Pointer, PointerBuf};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    borrow::Cow,
    fmt::{self, Display, Formatter},
};
use thiserror::Error;

#[cfg(feature = "diff")]
mod diff;

#[cfg(feature = "diff")]
pub use self::diff::diff;

struct WriteAdapter<'a>(&'a mut dyn fmt::Write);

impl<'a> std::io::Write for WriteAdapter<'a> {
    fn write(&mut self, buf: &[u8]) -> Result<usize, std::io::Error> {
        let s = std::str::from_utf8(buf).unwrap();
        self.0
            .write_str(s)
            .map_err(|_| std::io::Error::from(std::io::ErrorKind::Other))?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> Result<(), std::io::Error> {
        Ok(())
    }
}

macro_rules! impl_display {
    ($name:ident) => {
        impl Display for $name {
            fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
                let alternate = f.alternate();
                if alternate {
                    serde_json::to_writer_pretty(WriteAdapter(f), self)
                        .map_err(|_| std::fmt::Error)?;
                } else {
                    serde_json::to_writer(WriteAdapter(f), self).map_err(|_| std::fmt::Error)?;
                }
                Ok(())
            }
        }
    };
}

/// Representation of JSON Patch (list of patch operations)
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct Patch(pub Vec<PatchOperation>);

impl_display!(Patch);

impl std::ops::Deref for Patch {
    type Target = [PatchOperation];

    fn deref(&self) -> &[PatchOperation] {
        &self.0
    }
}

/// JSON Patch 'add' operation representation
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct AddOperation {
    /// JSON-Pointer value [RFC6901](https://tools.ietf.org/html/rfc6901) that references a location
    /// within the target document where the operation is performed.
    #[cfg_attr(feature = "utoipa", schema(value_type = String))]
    pub path: PointerBuf,
    /// Value to add to the target location.
    pub value: Value,
}

impl_display!(AddOperation);

/// JSON Patch 'remove' operation representation
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct RemoveOperation {
    /// JSON-Pointer value [RFC6901](https://tools.ietf.org/html/rfc6901) that references a location
    /// within the target document where the operation is performed.
    #[cfg_attr(feature = "utoipa", schema(value_type = String))]
    pub path: PointerBuf,
}

impl_display!(RemoveOperation);

/// JSON Patch 'replace' operation representation
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct ReplaceOperation {
    /// JSON-Pointer value [RFC6901](https://tools.ietf.org/html/rfc6901) that references a location
    /// within the target document where the operation is performed.
    #[cfg_attr(feature = "utoipa", schema(value_type = String))]
    pub path: PointerBuf,
    /// Value to replace with.
    pub value: Value,
}

impl_display!(ReplaceOperation);

/// JSON Patch 'move' operation representation
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct MoveOperation {
    /// JSON-Pointer value [RFC6901](https://tools.ietf.org/html/rfc6901) that references a location
    /// to move value from.
    #[cfg_attr(feature = "utoipa", schema(value_type = String))]
    pub from: PointerBuf,
    /// JSON-Pointer value [RFC6901](https://tools.ietf.org/html/rfc6901) that references a location
    /// within the target document where the operation is performed.
    #[cfg_attr(feature = "utoipa", schema(value_type = String))]
    pub path: PointerBuf,
}

impl_display!(MoveOperation);

/// JSON Patch 'copy' operation representation
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct CopyOperation {
    /// JSON-Pointer value [RFC6901](https://tools.ietf.org/html/rfc6901) that references a location
    /// to copy value from.
    #[cfg_attr(feature = "utoipa", schema(value_type = String))]
    pub from: PointerBuf,
    /// JSON-Pointer value [RFC6901](https://tools.ietf.org/html/rfc6901) that references a location
    /// within the target document where the operation is performed.
    #[cfg_attr(feature = "utoipa", schema(value_type = String))]
    pub path: PointerBuf,
}

impl_display!(CopyOperation);

/// JSON Patch 'test' operation representation
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct TestOperation {
    /// JSON-Pointer value [RFC6901](https://tools.ietf.org/html/rfc6901) that references a location
    /// within the target document where the operation is performed.
    #[cfg_attr(feature = "utoipa", schema(value_type = String))]
    pub path: PointerBuf,
    /// Value to test against.
    pub value: Value,
}

impl_display!(TestOperation);

/// JSON Patch single patch operation
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(tag = "op")]
#[serde(rename_all = "lowercase")]
pub enum PatchOperation {
    /// 'add' operation
    Add(AddOperation),
    /// 'remove' operation
    Remove(RemoveOperation),
    /// 'replace' operation
    Replace(ReplaceOperation),
    /// 'move' operation
    Move(MoveOperation),
    /// 'copy' operation
    Copy(CopyOperation),
    /// 'test' operation
    Test(TestOperation),
}

impl_display!(PatchOperation);

impl PatchOperation {
    /// Returns a reference to the path the operation applies to.
    pub fn path(&self) -> &Pointer {
        match self {
            Self::Add(op) => &op.path,
            Self::Remove(op) => &op.path,
            Self::Replace(op) => &op.path,
            Self::Move(op) => &op.path,
            Self::Copy(op) => &op.path,
            Self::Test(op) => &op.path,
        }
    }
}

impl Default for PatchOperation {
    fn default() -> Self {
        PatchOperation::Test(TestOperation::default())
    }
}

/// This type represents all possible errors that can occur when applying JSON patch
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum PatchErrorKind {
    /// `test` operation failed because values did not match.
    #[error("value did not match")]
    TestFailed,
    /// `from` JSON pointer in a `move` or a `copy` operation was incorrect.
    #[error("\"from\" path is invalid")]
    InvalidFromPointer,
    /// `path` JSON pointer is incorrect.
    #[error("path is invalid")]
    InvalidPointer,
    /// `move` operation failed because target is inside the `from` location.
    #[error("cannot move the value inside itself")]
    CannotMoveInsideItself,
}

/// This type represents all possible errors that can occur when applying JSON patch
#[derive(Debug, Error)]
#[error("operation '/{operation}' failed at path '{path}': {kind}")]
#[non_exhaustive]
pub struct PatchError {
    /// Index of the operation that has failed.
    pub operation: usize,
    /// `path` of the operation.
    pub path: PointerBuf,
    /// Kind of the error.
    pub kind: PatchErrorKind,
}

fn translate_error(kind: PatchErrorKind, operation: usize, path: &Pointer) -> PatchError {
    PatchError {
        operation,
        path: path.to_owned(),
        kind,
    }
}

fn unescape(s: &str) -> Cow<str> {
    if s.contains('~') {
        Cow::Owned(s.replace("~1", "/").replace("~0", "~"))
    } else {
        Cow::Borrowed(s)
    }
}

fn parse_index(str: &str, len: usize) -> Result<usize, PatchErrorKind> {
    // RFC 6901 prohibits leading zeroes in index
    if (str.starts_with('0') && str.len() != 1) || str.starts_with('+') {
        return Err(PatchErrorKind::InvalidPointer);
    }
    match str.parse::<usize>() {
        Ok(index) if index < len => Ok(index),
        _ => Err(PatchErrorKind::InvalidPointer),
    }
}

fn split_pointer(pointer: &str) -> Result<(&str, &str), PatchErrorKind> {
    pointer
        .rfind('/')
        .ok_or(PatchErrorKind::InvalidPointer)
        .map(|idx| (&pointer[0..idx], &pointer[idx + 1..]))
}

fn add(doc: &mut Value, path: &str, value: Value) -> Result<Option<Value>, PatchErrorKind> {
    if path.is_empty() {
        return Ok(Some(std::mem::replace(doc, value)));
    }

    let (parent, last_unescaped) = split_pointer(path)?;
    let parent = doc
        .pointer_mut(parent)
        .ok_or(PatchErrorKind::InvalidPointer)?;

    match *parent {
        Value::Object(ref mut obj) => Ok(obj.insert(unescape(last_unescaped).into_owned(), value)),
        Value::Array(ref mut arr) if last_unescaped == "-" => {
            arr.push(value);
            Ok(None)
        }
        Value::Array(ref mut arr) => {
            let idx = parse_index(last_unescaped, arr.len() + 1)?;
            arr.insert(idx, value);
            Ok(None)
        }
        _ => Err(PatchErrorKind::InvalidPointer),
    }
}

fn remove(doc: &mut Value, path: &str, allow_last: bool) -> Result<Value, PatchErrorKind> {
    let (parent, last_unescaped) = split_pointer(path)?;
    let parent = doc
        .pointer_mut(parent)
        .ok_or(PatchErrorKind::InvalidPointer)?;

    match *parent {
        Value::Object(ref mut obj) => match obj.remove(unescape(last_unescaped).as_ref()) {
            None => Err(PatchErrorKind::InvalidPointer),
            Some(val) => Ok(val),
        },
        Value::Array(ref mut arr) if allow_last && last_unescaped == "-" => Ok(arr.pop().unwrap()),
        Value::Array(ref mut arr) => {
            let idx = parse_index(last_unescaped, arr.len())?;
            Ok(arr.remove(idx))
        }
        _ => Err(PatchErrorKind::InvalidPointer),
    }
}

fn replace(doc: &mut Value, path: &str, value: Value) -> Result<Value, PatchErrorKind> {
    let target = doc
        .pointer_mut(path)
        .ok_or(PatchErrorKind::InvalidPointer)?;
    Ok(std::mem::replace(target, value))
}

fn mov(
    doc: &mut Value,
    from: &str,
    path: &str,
    allow_last: bool,
) -> Result<Option<Value>, PatchErrorKind> {
    // Check we are not moving inside own child
    if path.starts_with(from) && path[from.len()..].starts_with('/') {
        return Err(PatchErrorKind::CannotMoveInsideItself);
    }
    let val = remove(doc, from, allow_last).map_err(|err| match err {
        PatchErrorKind::InvalidPointer => PatchErrorKind::InvalidFromPointer,
        err => err,
    })?;
    add(doc, path, val)
}

fn copy(doc: &mut Value, from: &str, path: &str) -> Result<Option<Value>, PatchErrorKind> {
    let source = doc
        .pointer(from)
        .ok_or(PatchErrorKind::InvalidFromPointer)?
        .clone();
    add(doc, path, source)
}

fn test(doc: &Value, path: &str, expected: &Value) -> Result<(), PatchErrorKind> {
    let target = doc.pointer(path).ok_or(PatchErrorKind::InvalidPointer)?;
    if *target == *expected {
        Ok(())
    } else {
        Err(PatchErrorKind::TestFailed)
    }
}

/// Patch provided JSON document (given as `serde_json::Value`) in-place. If any of the patch is
/// failed, all previous operations are reverted. In case of internal error resulting in panic,
/// document might be left in inconsistent state.
///
/// # Example
/// Create and patch document:
///
/// ```rust
/// #[macro_use]
/// use json_patch::{Patch, patch};
/// use serde_json::{from_value, json};
///
/// # pub fn main() {
/// let mut doc = json!([
///     { "name": "Andrew" },
///     { "name": "Maxim" }
/// ]);
///
/// let p: Patch = from_value(json!([
///   { "op": "test", "path": "/0/name", "value": "Andrew" },
///   { "op": "add", "path": "/0/happy", "value": true }
/// ])).unwrap();
///
/// patch(&mut doc, &p).unwrap();
/// assert_eq!(doc, json!([
///   { "name": "Andrew", "happy": true },
///   { "name": "Maxim" }
/// ]));
///
/// # }
/// ```
pub fn patch(doc: &mut Value, patch: &[PatchOperation]) -> Result<(), PatchError> {
    let mut undo_stack = Vec::with_capacity(patch.len());
    if let Err(e) = apply_patches(doc, patch, Some(&mut undo_stack)) {
        if let Err(e) = undo_patches(doc, &undo_stack) {
            unreachable!("unable to undo applied patches: {e}")
        }
        return Err(e);
    }
    Ok(())
}

/// Patch provided JSON document (given as `serde_json::Value`) in-place. Different from [`patch`]
/// if any patch failed, the document is left in an inconsistent state. In case of internal error
/// resulting in panic, document might be left in inconsistent state.
///
/// # Example
/// Create and patch document:
///
/// ```rust
/// #[macro_use]
/// use json_patch::{Patch, patch_unsafe};
/// use serde_json::{from_value, json};
///
/// # pub fn main() {
/// let mut doc = json!([
///     { "name": "Andrew" },
///     { "name": "Maxim" }
/// ]);
///
/// let p: Patch = from_value(json!([
///   { "op": "test", "path": "/0/name", "value": "Andrew" },
///   { "op": "add", "path": "/0/happy", "value": true }
/// ])).unwrap();
///
/// patch_unsafe(&mut doc, &p).unwrap();
/// assert_eq!(doc, json!([
///   { "name": "Andrew", "happy": true },
///   { "name": "Maxim" }
/// ]));
///
/// # }
/// ```
pub fn patch_unsafe(doc: &mut Value, patch: &[PatchOperation]) -> Result<(), PatchError> {
    apply_patches(doc, patch, None)
}

/// Undoes operations performed by `apply_patches`. This is useful to recover the original document
/// in case of an error.
fn undo_patches(doc: &mut Value, undo_patches: &[PatchOperation]) -> Result<(), PatchError> {
    for (operation, patch) in undo_patches.iter().enumerate().rev() {
        match patch {
            PatchOperation::Add(op) => {
                add(doc, op.path.as_str(), op.value.clone())
                    .map_err(|e| translate_error(e, operation, &op.path))?;
            }
            PatchOperation::Remove(op) => {
                remove(doc, op.path.as_str(), true)
                    .map_err(|e| translate_error(e, operation, &op.path))?;
            }
            PatchOperation::Replace(op) => {
                replace(doc, op.path.as_str(), op.value.clone())
                    .map_err(|e| translate_error(e, operation, &op.path))?;
            }
            PatchOperation::Move(op) => {
                mov(doc, op.from.as_str(), op.path.as_str(), true)
                    .map_err(|e| translate_error(e, operation, &op.path))?;
            }
            PatchOperation::Copy(op) => {
                copy(doc, op.from.as_str(), op.path.as_str())
                    .map_err(|e| translate_error(e, operation, &op.path))?;
            }
            _ => unreachable!(),
        }
    }

    Ok(())
}

// Apply patches while tracking all the changes being made so they can be reverted back in case
// subsequent patches fail. The inverse of all state changes is recorded in the `undo_stack` which
// can be reapplied using `undo_patches` to get back to the original document.
fn apply_patches(
    doc: &mut Value,
    patches: &[PatchOperation],
    undo_stack: Option<&mut Vec<PatchOperation>>,
) -> Result<(), PatchError> {
    for (operation, patch) in patches.iter().enumerate() {
        match patch {
            PatchOperation::Add(ref op) => {
                let prev = add(doc, op.path.as_str(), op.value.clone())
                    .map_err(|e| translate_error(e, operation, &op.path))?;
                if let Some(&mut ref mut undo_stack) = undo_stack {
                    undo_stack.push(match prev {
                        None => PatchOperation::Remove(RemoveOperation {
                            path: op.path.clone(),
                        }),
                        Some(v) => PatchOperation::Add(AddOperation {
                            path: op.path.clone(),
                            value: v,
                        }),
                    })
                }
            }
            PatchOperation::Remove(ref op) => {
                let prev = remove(doc, op.path.as_str(), false)
                    .map_err(|e| translate_error(e, operation, &op.path))?;
                if let Some(&mut ref mut undo_stack) = undo_stack {
                    undo_stack.push(PatchOperation::Add(AddOperation {
                        path: op.path.clone(),
                        value: prev,
                    }))
                }
            }
            PatchOperation::Replace(ref op) => {
                let prev = replace(doc, op.path.as_str(), op.value.clone())
                    .map_err(|e| translate_error(e, operation, &op.path))?;
                if let Some(&mut ref mut undo_stack) = undo_stack {
                    undo_stack.push(PatchOperation::Replace(ReplaceOperation {
                        path: op.path.clone(),
                        value: prev,
                    }))
                }
            }
            PatchOperation::Move(ref op) => {
                let prev = mov(doc, op.from.as_str(), op.path.as_str(), false)
                    .map_err(|e| translate_error(e, operation, &op.path))?;
                if let Some(&mut ref mut undo_stack) = undo_stack {
                    if let Some(prev) = prev {
                        undo_stack.push(PatchOperation::Add(AddOperation {
                            path: op.path.clone(),
                            value: prev,
                        }));
                    }
                    undo_stack.push(PatchOperation::Move(MoveOperation {
                        from: op.path.clone(),
                        path: op.from.clone(),
                    }));
                }
            }
            PatchOperation::Copy(ref op) => {
                let prev = copy(doc, op.from.as_str(), op.path.as_str())
                    .map_err(|e| translate_error(e, operation, &op.path))?;
                if let Some(&mut ref mut undo_stack) = undo_stack {
                    undo_stack.push(match prev {
                        None => PatchOperation::Remove(RemoveOperation {
                            path: op.path.clone(),
                        }),
                        Some(v) => PatchOperation::Add(AddOperation {
                            path: op.path.clone(),
                            value: v,
                        }),
                    })
                }
            }
            PatchOperation::Test(ref op) => {
                test(doc, op.path.as_str(), &op.value)
                    .map_err(|e| translate_error(e, operation, &op.path))?;
            }
        }
    }

    Ok(())
}

/// Patch provided JSON document (given as `serde_json::Value`) in place with JSON Merge Patch
/// (RFC 7396).
///
/// # Example
/// Create and patch document:
///
/// ```rust
/// #[macro_use]
/// use json_patch::merge;
/// use serde_json::json;
///
/// # pub fn main() {
/// let mut doc = json!({
///   "title": "Goodbye!",
///   "author" : {
///     "givenName" : "John",
///     "familyName" : "Doe"
///   },
///   "tags":[ "example", "sample" ],
///   "content": "This will be unchanged"
/// });
///
/// let patch = json!({
///   "title": "Hello!",
///   "phoneNumber": "+01-123-456-7890",
///   "author": {
///     "familyName": null
///   },
///   "tags": [ "example" ]
/// });
///
/// merge(&mut doc, &patch);
/// assert_eq!(doc, json!({
///   "title": "Hello!",
///   "author" : {
///     "givenName" : "John"
///   },
///   "tags": [ "example" ],
///   "content": "This will be unchanged",
///   "phoneNumber": "+01-123-456-7890"
/// }));
/// # }
/// ```
pub fn merge(doc: &mut Value, patch: &Value) {
    if !patch.is_object() {
        *doc = patch.clone();
        return;
    }

    if !doc.is_object() {
        *doc = Value::Object(Map::new());
    }
    let map = doc.as_object_mut().unwrap();
    for (key, value) in patch.as_object().unwrap() {
        if value.is_null() {
            map.remove(key.as_str());
        } else {
            merge(map.entry(key.as_str()).or_insert(Value::Null), value);
        }
    }
}
