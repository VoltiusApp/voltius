use json_patch::{
    AddOperation, CopyOperation, MoveOperation, Patch, PatchOperation, RemoveOperation,
    ReplaceOperation, TestOperation,
};
use serde_json::{from_str, from_value, json, Value};

#[test]
fn parse_from_value() {
    let json = json!([{"op": "add", "path": "/a/b", "value": 1}, {"op": "remove", "path": "/c"}]);
    let patch: Patch = from_value(json).unwrap();

    assert_eq!(
        patch,
        Patch(vec![
            PatchOperation::Add(AddOperation {
                path: "/a/b".parse().unwrap(),
                value: Value::from(1),
            }),
            PatchOperation::Remove(RemoveOperation {
                path: "/c".parse().unwrap(),
            }),
        ])
    );

    let _patch: Patch =
        from_str(r#"[{"op": "add", "path": "/a/b", "value": 1}, {"op": "remove", "path": "/c"}]"#)
            .unwrap();
}

#[test]
fn parse_from_string() {
    let patch: Patch =
        from_str(r#"[{"op": "add", "path": "/a/b", "value": 1}, {"op": "remove", "path": "/c"}]"#)
            .unwrap();

    assert_eq!(
        patch,
        Patch(vec![
            PatchOperation::Add(AddOperation {
                path: "/a/b".parse().unwrap(),
                value: Value::from(1),
            }),
            PatchOperation::Remove(RemoveOperation {
                path: "/c".parse().unwrap(),
            }),
        ])
    );
}

#[test]
fn serialize_patch() {
    let s = r#"[{"op":"add","path":"/a/b","value":1},{"op":"remove","path":"/c"}]"#;
    let patch: Patch = from_str(s).unwrap();

    let serialized = serde_json::to_string(&patch).unwrap();
    assert_eq!(serialized, s);
}

#[test]
fn display_add_operation() {
    let op = PatchOperation::Add(AddOperation {
        path: "/a/b/c".parse().unwrap(),
        value: json!(["hello", "bye"]),
    });
    assert_eq!(
        op.to_string(),
        r#"{"op":"add","path":"/a/b/c","value":["hello","bye"]}"#
    );
    assert_eq!(
        format!("{:#}", op),
        r#"{
  "op": "add",
  "path": "/a/b/c",
  "value": [
    "hello",
    "bye"
  ]
}"#
    );
}

#[test]
fn display_remove_operation() {
    let op = PatchOperation::Remove(RemoveOperation {
        path: "/a/b/c".parse().unwrap(),
    });
    assert_eq!(op.to_string(), r#"{"op":"remove","path":"/a/b/c"}"#);
    assert_eq!(
        format!("{:#}", op),
        r#"{
  "op": "remove",
  "path": "/a/b/c"
}"#
    );
}

#[test]
fn display_replace_operation() {
    let op = PatchOperation::Replace(ReplaceOperation {
        path: "/a/b/c".parse().unwrap(),
        value: json!(42),
    });
    assert_eq!(
        op.to_string(),
        r#"{"op":"replace","path":"/a/b/c","value":42}"#
    );
    assert_eq!(
        format!("{:#}", op),
        r#"{
  "op": "replace",
  "path": "/a/b/c",
  "value": 42
}"#
    );
}

#[test]
fn display_move_operation() {
    let op = PatchOperation::Move(MoveOperation {
        from: "/a/b/c".parse().unwrap(),
        path: "/a/b/d".parse().unwrap(),
    });
    assert_eq!(
        op.to_string(),
        r#"{"op":"move","from":"/a/b/c","path":"/a/b/d"}"#
    );
    assert_eq!(
        format!("{:#}", op),
        r#"{
  "op": "move",
  "from": "/a/b/c",
  "path": "/a/b/d"
}"#
    );
}

#[test]
fn display_copy_operation() {
    let op = PatchOperation::Copy(CopyOperation {
        from: "/a/b/d".parse().unwrap(),
        path: "/a/b/e".parse().unwrap(),
    });
    assert_eq!(
        op.to_string(),
        r#"{"op":"copy","from":"/a/b/d","path":"/a/b/e"}"#
    );
    assert_eq!(
        format!("{:#}", op),
        r#"{
  "op": "copy",
  "from": "/a/b/d",
  "path": "/a/b/e"
}"#
    );
}

#[test]
fn display_test_operation() {
    let op = PatchOperation::Test(TestOperation {
        path: "/a/b/c".parse().unwrap(),
        value: json!("hello"),
    });
    assert_eq!(
        op.to_string(),
        r#"{"op":"test","path":"/a/b/c","value":"hello"}"#
    );
    assert_eq!(
        format!("{:#}", op),
        r#"{
  "op": "test",
  "path": "/a/b/c",
  "value": "hello"
}"#
    );
}

#[test]
fn display_patch() {
    let patch = Patch(vec![
        PatchOperation::Add(AddOperation {
            path: "/a/b/c".parse().unwrap(),
            value: json!(["hello", "bye"]),
        }),
        PatchOperation::Remove(RemoveOperation {
            path: "/a/b/c".parse().unwrap(),
        }),
    ]);

    assert_eq!(
        patch.to_string(),
        r#"[{"op":"add","path":"/a/b/c","value":["hello","bye"]},{"op":"remove","path":"/a/b/c"}]"#
    );
    assert_eq!(
        format!("{:#}", patch),
        r#"[
  {
    "op": "add",
    "path": "/a/b/c",
    "value": [
      "hello",
      "bye"
    ]
  },
  {
    "op": "remove",
    "path": "/a/b/c"
  }
]"#
    );
}

#[test]
fn display_patch_default() {
    let patch = Patch::default();
    assert_eq!(patch.to_string(), r#"[]"#);
}

#[test]
fn display_patch_operation_default() {
    let op = PatchOperation::default();
    assert_eq!(op.to_string(), r#"{"op":"test","path":"","value":null}"#);
}
