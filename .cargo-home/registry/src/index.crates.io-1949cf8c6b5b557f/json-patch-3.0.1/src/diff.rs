use crate::Patch;
use jsonptr::PointerBuf;
use serde_json::{Map, Value};

fn diff_impl(left: &Value, right: &Value, pointer: &mut PointerBuf, patch: &mut super::Patch) {
    match (left, right) {
        (Value::Object(ref left_obj), Value::Object(ref right_obj)) => {
            diff_object(left_obj, right_obj, pointer, patch);
        }
        (Value::Array(ref left_array), Value::Array(ref ref_array)) => {
            diff_array(left_array, ref_array, pointer, patch);
        }
        (_, _) if left == right => {
            // Nothing to do
        }
        (_, _) => {
            // Values are different, replace the value at the path
            patch
                .0
                .push(super::PatchOperation::Replace(super::ReplaceOperation {
                    path: pointer.clone(),
                    value: right.clone(),
                }));
        }
    }
}

fn diff_array(left: &[Value], right: &[Value], pointer: &mut PointerBuf, patch: &mut Patch) {
    let len = left.len().max(right.len());
    let mut shift = 0usize;
    for idx in 0..len {
        pointer.push_back(idx - shift);
        match (left.get(idx), right.get(idx)) {
            (Some(left), Some(right)) => {
                // Both array have an element at this index
                diff_impl(left, right, pointer, patch);
            }
            (Some(_left), None) => {
                // The left array has an element at this index, but not the right
                shift += 1;
                patch
                    .0
                    .push(super::PatchOperation::Remove(super::RemoveOperation {
                        path: pointer.clone(),
                    }));
            }
            (None, Some(right)) => {
                // The right array has an element at this index, but not the left
                patch
                    .0
                    .push(super::PatchOperation::Add(super::AddOperation {
                        path: pointer.clone(),
                        value: right.clone(),
                    }));
            }
            (None, None) => {
                unreachable!()
            }
        }
        pointer.pop_back();
    }
}

fn diff_object(
    left: &Map<String, Value>,
    right: &Map<String, Value>,
    pointer: &mut PointerBuf,
    patch: &mut Patch,
) {
    // Add or replace keys in the right object
    for (key, right_value) in right {
        pointer.push_back(key);
        match left.get(key) {
            Some(left_value) => {
                diff_impl(left_value, right_value, pointer, patch);
            }
            None => {
                patch
                    .0
                    .push(super::PatchOperation::Add(super::AddOperation {
                        path: pointer.clone(),
                        value: right_value.clone(),
                    }));
            }
        }
        pointer.pop_back();
    }

    // Remove keys that are not in the right object
    for key in left.keys() {
        if !right.contains_key(key) {
            pointer.push_back(key);
            patch
                .0
                .push(super::PatchOperation::Remove(super::RemoveOperation {
                    path: pointer.clone(),
                }));
            pointer.pop_back();
        }
    }
}

/// Diff two JSON documents and generate a JSON Patch (RFC 6902).
///
/// # Example
/// Diff two JSONs:
///
/// ```rust
/// #[macro_use]
/// use json_patch::{Patch, patch, diff};
/// use serde_json::{json, from_value};
///
/// # pub fn main() {
/// let left = json!({
///   "title": "Goodbye!",
///   "author" : {
///     "givenName" : "John",
///     "familyName" : "Doe"
///   },
///   "tags":[ "example", "sample" ],
///   "content": "This will be unchanged"
/// });
///
/// let right = json!({
///   "title": "Hello!",
///   "author" : {
///     "givenName" : "John"
///   },
///   "tags": [ "example" ],
///   "content": "This will be unchanged",
///   "phoneNumber": "+01-123-456-7890"
/// });
///
/// let p = diff(&left, &right);
/// assert_eq!(p, from_value::<Patch>(json!([
///   { "op": "replace", "path": "/title", "value": "Hello!" },
///   { "op": "remove", "path": "/author/familyName" },
///   { "op": "remove", "path": "/tags/1" },
///   { "op": "add", "path": "/phoneNumber", "value": "+01-123-456-7890" },
/// ])).unwrap());
///
/// let mut doc = left.clone();
/// patch(&mut doc, &p).unwrap();
/// assert_eq!(doc, right);
///
/// # }
/// ```
pub fn diff(left: &Value, right: &Value) -> super::Patch {
    let mut patch = super::Patch::default();
    let mut path = PointerBuf::new();
    diff_impl(left, right, &mut path, &mut patch);
    patch
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    #[test]
    pub fn replace_all() {
        let mut left = json!({"title": "Hello!"});
        let patch = super::diff(&left, &Value::Null);
        assert_eq!(
            patch,
            serde_json::from_value(json!([
                { "op": "replace", "path": "", "value": null },
            ]))
            .unwrap()
        );
        crate::patch(&mut left, &patch).unwrap();
    }

    #[test]
    pub fn diff_empty_key() {
        let mut left = json!({"title": "Something", "": "Hello!"});
        let right = json!({"title": "Something", "": "Bye!"});
        let patch = super::diff(&left, &right);
        assert_eq!(
            patch,
            serde_json::from_value(json!([
                { "op": "replace", "path": "/", "value": "Bye!" },
            ]))
            .unwrap()
        );
        crate::patch(&mut left, &patch).unwrap();
        assert_eq!(left, right);
    }

    #[test]
    pub fn add_all() {
        let right = json!({"title": "Hello!"});
        let patch = super::diff(&Value::Null, &right);
        assert_eq!(
            patch,
            serde_json::from_value(json!([
                { "op": "replace", "path": "", "value": { "title": "Hello!" } },
            ]))
            .unwrap()
        );

        let mut left = Value::Null;
        crate::patch(&mut left, &patch).unwrap();
        assert_eq!(left, right);
    }

    #[test]
    pub fn remove_all() {
        let mut left = json!(["hello", "bye"]);
        let right = json!([]);
        let patch = super::diff(&left, &right);
        assert_eq!(
            patch,
            serde_json::from_value(json!([
                { "op": "remove", "path": "/0" },
                { "op": "remove", "path": "/0" },
            ]))
            .unwrap()
        );

        crate::patch(&mut left, &patch).unwrap();
        assert_eq!(left, right);
    }

    #[test]
    pub fn remove_tail() {
        let mut left = json!(["hello", "bye", "hi"]);
        let right = json!(["hello"]);
        let patch = super::diff(&left, &right);
        assert_eq!(
            patch,
            serde_json::from_value(json!([
                { "op": "remove", "path": "/1" },
                { "op": "remove", "path": "/1" },
            ]))
            .unwrap()
        );

        crate::patch(&mut left, &patch).unwrap();
        assert_eq!(left, right);
    }

    #[test]
    pub fn add_tail() {
        let mut left = json!(["hello"]);
        let right = json!(["hello", "bye", "hi"]);
        let patch = super::diff(&left, &right);
        assert_eq!(
            patch,
            serde_json::from_value(json!([
                { "op": "add", "path": "/1", "value": "bye" },
                { "op": "add", "path": "/2", "value": "hi" }
            ]))
            .unwrap()
        );

        crate::patch(&mut left, &patch).unwrap();
        assert_eq!(left, right);
    }

    #[test]
    pub fn replace_object() {
        let mut left = json!(["hello", "bye"]);
        let right = json!({"hello": "bye"});
        let patch = super::diff(&left, &right);
        assert_eq!(
            patch,
            serde_json::from_value(json!([
                { "op": "replace", "path": "", "value": {"hello": "bye"} }
            ]))
            .unwrap()
        );

        crate::patch(&mut left, &patch).unwrap();
        assert_eq!(left, right);
    }

    #[test]
    fn escape_json_keys() {
        let mut left = json!({
            "/slashed/path/with/~": 1
        });
        let right = json!({
            "/slashed/path/with/~": 2,
        });
        let patch = super::diff(&left, &right);

        crate::patch(&mut left, &patch).unwrap();
        assert_eq!(left, right);
    }

    #[test]
    pub fn replace_object_array() {
        let mut left = json!({ "style": { "ref": {"name": "name"} } });
        let right = json!({ "style": [{ "ref": {"hello": "hello"} }]});
        let patch = crate::diff(&left, &right);

        assert_eq!(
            patch,
            serde_json::from_value(json!([
                { "op": "replace", "path": "/style", "value": [{ "ref": {"hello": "hello"} }] },
            ]))
            .unwrap()
        );
        crate::patch(&mut left, &patch).unwrap();
        assert_eq!(left, right);
    }

    #[test]
    pub fn replace_array_object() {
        let mut left = json!({ "style": [{ "ref": {"hello": "hello"} }]});
        let right = json!({ "style": { "ref": {"name": "name"} } });
        let patch = crate::diff(&left, &right);

        assert_eq!(
            patch,
            serde_json::from_value(json!([
                { "op": "replace", "path": "/style", "value": { "ref": {"name": "name"} } },
            ]))
            .unwrap()
        );
        crate::patch(&mut left, &patch).unwrap();
        assert_eq!(left, right);
    }

    #[test]
    pub fn remove_keys() {
        let mut left = json!({"first": 1, "second": 2, "third": 3});
        let right = json!({"first": 1, "second": 2});
        let patch = super::diff(&left, &right);
        assert_eq!(
            patch,
            serde_json::from_value(json!([
                { "op": "remove", "path": "/third" }
            ]))
            .unwrap()
        );

        crate::patch(&mut left, &patch).unwrap();
        assert_eq!(left, right);
    }

    #[test]
    pub fn add_keys() {
        let mut left = json!({"first": 1, "second": 2});
        let right = json!({"first": 1, "second": 2, "third": 3});
        let patch = super::diff(&left, &right);
        assert_eq!(
            patch,
            serde_json::from_value(json!([
                { "op": "add", "path": "/third", "value": 3 }
            ]))
            .unwrap()
        );

        crate::patch(&mut left, &patch).unwrap();
        assert_eq!(left, right);
    }
}
