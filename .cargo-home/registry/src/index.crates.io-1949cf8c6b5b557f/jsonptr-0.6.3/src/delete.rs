//! # Delete values based on JSON Pointers
//!
//! This module provides the [`Delete`] trait which is implemented by types that
//! can internally remove a value based on a JSON Pointer.
//!
//! The rules of deletion are determined by the implementation, with the
//! provided implementations (`"json"` & `"toml"`) operating as follows:
//! - If the [`Pointer`] can be resolved, then the [`Value`](`Delete::Value`) is
//!   deleted and returned as `Some(value)`.
//! - If the [`Pointer`] fails to resolve for any reason, `Ok(None)` is
//!   returned.
//! - If the [`Pointer`] is root, `value` is replaced:
//!     - `"json"` - `serde_json::Value::Null`
//!     - `"toml"` - `toml::Value::Table::Default`
//!
//! This module is enabled by default with the `"delete"` feature flag.
//!
//! ## Usage
//!  Deleting a resolved pointer:
//! ```rust
//! use jsonptr::{Pointer, delete::Delete};
//! use serde_json::json;
//!
//! let mut data = json!({ "foo": { "bar": { "baz": "qux" } } });
//! let ptr = Pointer::from_static("/foo/bar/baz");
//! assert_eq!(data.delete(&ptr), Some("qux".into()));
//! assert_eq!(data, json!({ "foo": { "bar": {} } }));
//! ```
//! Deleting a non-existent Pointer returns `None`:
//! ```rust
//! use jsonptr::{ Pointer, delete::Delete };
//! use serde_json::json;
//!
//! let mut data = json!({});
//! let ptr = Pointer::from_static("/foo/bar/baz");
//! assert_eq!(ptr.delete(&mut data), None);
//! assert_eq!(data, json!({}));
//! ```
//! Deleting a root pointer replaces the value with `Value::Null`:
//! ```rust
//! use jsonptr::{Pointer, delete::Delete};
//! use serde_json::json;
//!
//! let mut data = json!({ "foo": { "bar": "baz" } });
//! let ptr = Pointer::root();
//! assert_eq!(data.delete(&ptr), Some(json!({ "foo": { "bar": "baz" } })));
//! assert!(data.is_null());
//! ```
//!
//! ## Provided implementations
//!
//! | Lang  |     value type      | feature flag | Default |
//! | ----- |: ----------------- :|: ---------- :| ------- |
//! | JSON  | `serde_json::Value` |   `"json"`   |   ✓     |
//! | TOML  |    `toml::Value`    |   `"toml"`   |         |

use crate::Pointer;

/*
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                                    Delete                                    ║
║                                   ¯¯¯¯¯¯¯¯                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
*/

/// Delete is implemented by types which can internally remove a value based on
/// a JSON Pointer
pub trait Delete {
    /// The type of value that this implementation can operate on.
    type Value;

    /// Attempts to internally delete a value based upon a [Pointer].
    fn delete(&mut self, ptr: &Pointer) -> Option<Self::Value>;
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
    use super::Delete;
    use crate::Pointer;
    use core::mem;
    use serde_json::Value;

    impl Delete for Value {
        type Value = Value;
        fn delete(&mut self, ptr: &Pointer) -> Option<Self::Value> {
            let Some((parent_ptr, last)) = ptr.split_back() else {
                // deleting at root
                return Some(mem::replace(self, Value::Null));
            };
            parent_ptr
                .resolve_mut(self)
                .ok()
                .and_then(|parent| match parent {
                    Value::Array(children) => {
                        let idx = last.to_index().ok()?.for_len_incl(children.len()).ok()?;
                        children.remove(idx).into()
                    }
                    Value::Object(children) => children.remove(last.decoded().as_ref()),
                    _ => None,
                })
        }
    }
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
    use super::Delete;
    use crate::Pointer;
    use core::mem;
    use toml::{Table, Value};

    impl Delete for Value {
        type Value = Value;
        fn delete(&mut self, ptr: &Pointer) -> Option<Self::Value> {
            let Some((parent_ptr, last)) = ptr.split_back() else {
                // deleting at root
                return Some(mem::replace(self, Table::default().into()));
            };
            parent_ptr
                .resolve_mut(self)
                .ok()
                .and_then(|parent| match parent {
                    Value::Array(children) => {
                        let idx = last.to_index().ok()?.for_len_incl(children.len()).ok()?;
                        children.remove(idx).into()
                    }
                    Value::Table(children) => children.remove(last.decoded().as_ref()),
                    _ => None,
                })
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
    use super::Delete;
    use crate::Pointer;
    use core::fmt;

    use serde_json::json;
    struct Test<V> {
        data: V,
        ptr: &'static str,
        expected_data: V,
        expected_deleted: Option<V>,
    }
    impl<V> Test<V>
    where
        V: Delete<Value = V> + Clone + PartialEq + fmt::Display + fmt::Debug,
    {
        fn all(tests: impl IntoIterator<Item = Test<V>>) {
            tests.into_iter().enumerate().for_each(|(i, t)| t.run(i));
        }
        fn run(self, _i: usize) {
            let Test {
                mut data,
                ptr,
                expected_data,
                expected_deleted,
            } = self;

            let ptr = Pointer::from_static(ptr);
            let deleted = ptr.delete(&mut data);
            assert_eq!(expected_data, data);
            assert_eq!(expected_deleted, deleted);
        }
    }
    /*
    ╔═══════════════════════════════════════════════════╗
    ║                        json                       ║
    ╚═══════════════════════════════════════════════════╝
    */
    #[test]
    #[cfg(feature = "json")]
    fn delete_json() {
        Test::all([
            // 0
            Test {
                ptr: "/foo",
                data: json!({"foo": "bar"}),
                expected_data: json!({}),
                expected_deleted: Some(json!("bar")),
            },
            // 1
            Test {
                ptr: "/foo/bar",
                data: json!({"foo": {"bar": "baz"}}),
                expected_data: json!({"foo": {}}),
                expected_deleted: Some(json!("baz")),
            },
            // 2
            Test {
                ptr: "/foo/bar",
                data: json!({"foo": "bar"}),
                expected_data: json!({"foo": "bar"}),
                expected_deleted: None,
            },
            // 3
            Test {
                ptr: "/foo/bar",
                data: json!({"foo": {"bar": "baz"}}),
                expected_data: json!({"foo": {}}),
                expected_deleted: Some(json!("baz")),
            },
            // 4
            Test {
                ptr: "/foo/bar/0",
                data: json!({"foo": {"bar": ["baz", "qux"]}}),
                expected_data: json!({"foo": {"bar": ["qux"]}}),
                expected_deleted: Some(json!("baz")),
            },
            // 5
            Test {
                ptr: "/foo/0",
                data: json!({"foo": "bar"}),
                expected_data: json!({"foo": "bar"}),
                expected_deleted: None,
            },
            // 6
            Test {
                ptr: "/foo/bar/0/baz",
                data: json!({"foo": { "bar": [{"baz": "qux", "remaining": "field"}]}}),
                expected_data: json!({"foo": { "bar": [{"remaining": "field"}]} }),
                expected_deleted: Some(json!("qux")),
            },
            // 7
            // issue #18 - unable to delete root token https://github.com/chanced/jsonptr/issues/18
            Test {
                ptr: "/Example",
                data: json!({"Example": 21, "test": "test"}),
                expected_data: json!({"test": "test"}),
                expected_deleted: Some(json!(21)),
            },
            Test {
                ptr: "",
                data: json!({"Example": 21, "test": "test"}),
                expected_data: json!(null),
                expected_deleted: Some(json!({"Example": 21, "test": "test"})),
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
    fn delete_toml() {
        use toml::{toml, Table, Value};

        Test::all([
            // 0
            Test {
                data: toml! {"foo" = "bar"}.into(),
                ptr: "/foo",
                expected_data: Value::Table(Table::new()),
                expected_deleted: Some("bar".into()),
            },
            // 1
            Test {
                data: toml! {"foo" = {"bar" = "baz"}}.into(),
                ptr: "/foo/bar",
                expected_data: toml! {"foo" = {}}.into(),
                expected_deleted: Some("baz".into()),
            },
            // 2
            Test {
                data: toml! {"foo" = "bar"}.into(),
                ptr: "/foo/bar",
                expected_data: toml! {"foo" = "bar"}.into(),
                expected_deleted: None,
            },
            // 3
            Test {
                data: toml! {"foo" = {"bar" = "baz"}}.into(),
                ptr: "/foo/bar",
                expected_data: toml! {"foo" = {}}.into(),
                expected_deleted: Some("baz".into()),
            },
            // 4
            Test {
                data: toml! {"foo" = {"bar" = ["baz", "qux"]}}.into(),
                ptr: "/foo/bar/0",
                expected_data: toml! {"foo" = {"bar" = ["qux"]}}.into(),
                expected_deleted: Some("baz".into()),
            },
            // 5
            Test {
                data: toml! {"foo" = "bar"}.into(),
                ptr: "/foo/0",
                expected_data: toml! {"foo" = "bar"}.into(),
                expected_deleted: None,
            },
            // 6
            Test {
                data: toml! {"foo" = { "bar" = [{"baz" = "qux", "remaining" = "field"}]}}.into(),
                ptr: "/foo/bar/0/baz",
                expected_data: toml! {"foo" = { "bar" = [{"remaining" = "field"}]} }.into(),
                expected_deleted: Some("qux".into()),
            },
            // 7
            // issue #18 - unable to delete root token https://github.com/chanced/jsonptr/issues/18
            Test {
                data: toml! {"Example" = 21 "test" = "test"}.into(),
                ptr: "/Example",
                expected_data: toml! {"test" = "test"}.into(),
                expected_deleted: Some(21.into()),
            },
        ]);
    }
}
