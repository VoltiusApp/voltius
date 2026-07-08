# Changelog

## 0.3.0 (2022-12-10)

### Breaking Changes

- Removed `json_patch::patch_unsafe` operation as regular `patch` is it does not provide enough value.
- Error types changed to include some context.
- Removed `json_patch::from_value`. Use `serde_json::from_value` instead.

## 0.2.7 (2022-12-09)

### Fixed

- Fixed incorrect diffing for the whole document. Previously, differ would incorrectly yield path of `"/"` when the
  whole document is replaced. The correct path should be `""`. This is a breaking change.
  [#18](https://github.com/idubrov/json-patch/pull/18)
