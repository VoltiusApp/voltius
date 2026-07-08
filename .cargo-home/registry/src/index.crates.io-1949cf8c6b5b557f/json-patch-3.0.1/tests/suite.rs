use json_patch::Patch;
use serde::Deserialize;
use serde_json::Value;

#[test]
fn errors() {
    run_specs("tests/errors.yaml", Errors::ExactMatch, PatchKind::Patch);
}

#[test]
fn tests() {
    run_specs("specs/tests.json", Errors::IgnoreContent, PatchKind::Patch);
}

#[test]
fn spec_tests() {
    run_specs(
        "specs/spec_tests.json",
        Errors::IgnoreContent,
        PatchKind::Patch,
    );
}

#[test]
fn revert_tests() {
    run_specs(
        "specs/revert_tests.json",
        Errors::IgnoreContent,
        PatchKind::Patch,
    );
}

#[test]
fn merge_tests() {
    run_specs(
        "specs/merge_tests.json",
        Errors::IgnoreContent,
        PatchKind::MergePatch,
    );
}

#[derive(PartialEq, Eq, Clone, Copy)]
enum Errors {
    ExactMatch,
    IgnoreContent,
}

#[derive(PartialEq, Eq, Clone, Copy)]
enum PatchKind {
    Patch,
    MergePatch,
}

#[derive(Debug, Deserialize)]
struct PatchTestCase {
    comment: Option<String>,
    doc: Value,
    patch: Value,
    expected: Option<Value>,
    error: Option<String>,
    #[serde(default)]
    disabled: bool,
}

fn run_patch_test_case(tc: &PatchTestCase, kind: PatchKind) -> Result<Value, String> {
    let mut actual = tc.doc.clone();
    if kind == PatchKind::MergePatch {
        json_patch::merge(&mut actual, &tc.patch);
        return Ok(actual);
    }

    // Patch and verify that in case of error document wasn't changed
    let patch: Patch = serde_json::from_value(tc.patch.clone()).map_err(|err| err.to_string())?;
    json_patch::patch(&mut actual, &patch)
        .map_err(|e| {
            assert_eq!(
                tc.doc, actual,
                "no changes should be made to the original document"
            );
            e
        })
        .map_err(|err| err.to_string())?;
    Ok(actual)
}

fn run_specs(path: &str, errors: Errors, kind: PatchKind) {
    let cases = std::fs::read_to_string(path).unwrap();
    let is_yaml = path.ends_with(".yaml") || path.ends_with(".yml");
    let cases: Vec<PatchTestCase> = if is_yaml {
        serde_yaml::from_str(&cases).unwrap()
    } else {
        serde_json::from_str(&cases).unwrap()
    };

    for (idx, tc) in cases.into_iter().enumerate() {
        if tc.disabled {
            continue;
        }
        match run_patch_test_case(&tc, kind) {
            Ok(actual) => {
                if let Some(error) = tc.error {
                    panic!(
                        "expected to fail with an error: {}, got document {:?}",
                        error, actual
                    );
                } else {
                    let comment = tc.comment.as_deref().unwrap_or("");
                    let expected = if let Some(ref expected) = tc.expected {
                        expected
                    } else {
                        &tc.doc
                    };
                    assert_eq!(
                        *expected, actual,
                        "\nActual does not match expected in test case {}: {}",
                        idx, comment
                    );
                }
            }
            Err(actual_error) => {
                if let Some(expected_error) = tc.error {
                    if errors == Errors::ExactMatch {
                        assert_eq!(actual_error, expected_error, "Expected test case {} to fail with an error:\n{}\n\nbut instead failed with an error:\n{}", idx, expected_error, actual_error);
                    }
                } else {
                    panic!(
                        "Patch expected to succeed, but failed with an error:\n{}",
                        actual_error
                    );
                }
            }
        }
    }
}
