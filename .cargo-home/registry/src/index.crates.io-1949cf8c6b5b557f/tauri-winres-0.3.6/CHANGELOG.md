# Changelog

## \[0.3.6]

- `compile_for` didn't work at all
  - [119cb8a](https://github.com/tauri-apps/winres/commit/119cb8a98952a4b19f49cfba9e7c5fcd35e81e4f) fix: `compile_for` doesn't work at all ([#41](https://github.com/tauri-apps/winres/pull/41)) on 2026-04-27
- Update toml to 1.0 and increased the MSRV from 1.66 to 1.76 to match it
  - [1ad418b](https://github.com/tauri-apps/winres/commit/1ad418b6e510097187d8ca7d1fb0f1ca4ec2f829) chore(deps): update toml to 0.9 and bump MSRV ([#26](https://github.com/tauri-apps/winres/pull/26)) on 2025-07-31
  - [fc844a3](https://github.com/tauri-apps/winres/commit/fc844a35b130d00596e0c737c13572eec1ea8174) publish new versions ([#27](https://github.com/tauri-apps/winres/pull/27)) on 2025-07-31
  - [fca959a](https://github.com/tauri-apps/winres/commit/fca959ad5f5f1207eb1d75cf685db14a50e672d1) chore(deps): update rust crate toml to v1 and bump MSRV ([#37](https://github.com/tauri-apps/winres/pull/37)) on 2026-04-25
- Relaxed `windows-sys` dependency to `>=0.59, <=0.61` instead of `0.59`
  - [2832773](https://github.com/tauri-apps/winres/commit/2832773c1eaa0088bcf47139e446bd0c16c583be) chore(deps): relax windows-sys versions to a range `>=0.59, <=0.61` ([#33](https://github.com/tauri-apps/winres/pull/33)) on 2026-04-25

## \[0.3.5]

- llvm-rc doesn't support UNC path, so de-UNC as a workaround
  - [4e5c319](https://github.com/tauri-apps/winres/commit/4e5c319a99fee4811adfc0e1d31e4d6f9393f824) fix: remove UNC from paths ([#34](https://github.com/tauri-apps/winres/pull/34)) on 2025-11-10

## \[0.3.4]

- Fix the persistent "TOML parsing error".
  - [a11c1d6](https://github.com/tauri-apps/winres/commit/a11c1d6f16b0cb7ec58abb841394096592259e1f) fix: fixed "TOML parsing error" ([#30](https://github.com/tauri-apps/winres/pull/30)) on 2025-10-25

## \[0.3.3]

- Switch from IndexMap to BTreeMap for deterministic generation of the resource file.
  - [9a46409](https://github.com/tauri-apps/winres/commit/9a464098c18d4034735fa970877d1b45575de192) fix: use BTreeMap instead of IndexMap for determinism ([#28](https://github.com/tauri-apps/winres/pull/28)) on 2025-08-07

## \[0.3.2]

- Update toml to 0.9 and increased the MSRV from 1.65 to 1.66 to match it
  - [1ad418b](https://github.com/tauri-apps/winres/commit/1ad418b6e510097187d8ca7d1fb0f1ca4ec2f829) chore(deps): update toml to 0.9 and bump MSRV ([#26](https://github.com/tauri-apps/winres/pull/26)) on 2025-07-31

## \[0.3.1]

- Switch from HashMap to IndexMap for deterministic generation of the resource file.
  - [ad7d6af](https://github.com/tauri-apps/winres/commit/ad7d6afa03237f9f07790ddc0161ca1620672dec) Switch to IndexMap for determinism ([#23](https://github.com/tauri-apps/winres/pull/23)) on 2025-04-24

## \[0.3.0]

- `winres` is now more strict about `embed_resource`'s result (using manifest_required instead of manifest_option) and therefore may panic more likely, for example if the environment is missing a resource compiler.
  - [181645b](https://github.com/tauri-apps/winres/commit/181645b7fdfdc96da58df7e839bc2a14897d6233) feat: More strictly handle resource compiler issues. ([#20](https://github.com/tauri-apps/winres/pull/20)) on 2025-01-29

## \[0.2.1]

- Updated `embed-resource` to v3. No user facing changes.
  - [8e8897c](https://github.com/tauri-apps/winres/commit/8e8897c470e81f211a12a45edd5534926f2c691f) chore(deps): update rust crate embed-resource to v3 ([#18](https://github.com/tauri-apps/winres/pull/18)) on 2025-01-29

## \[0.2.0]

- Updated `toml` crate to `0.8`. This raises this crate's MSRV to `1.65`.
  - [fad716e](https://github.com/tauri-apps/winres/commit/fad716eb94ee178b5e886ec280707bbc5589b029) chore(deps): update toml to 0.8 ([#13](https://github.com/tauri-apps/winres/pull/13)) on 2025-01-10

## \[0.1.1]

- Added `compile_for` function to select which binaries to apply the resource to.
  - [3aa8411](https://github.com/tauri-apps/winres/commit/3aa84115f6a80d74fd28f4f8c81ef734ccb1c37e) refactor: Use embed-resource crate to compile resources ([#9](https://github.com/tauri-apps/winres/pull/9)) on 2023-05-04
- Use https://github.com/nabijaczleweli/rust-embed-resource to compile the resource for better cross-platform compilation support. Note that because of this a few methods are no-op now and marked as deprecated. Technically this was a breaking change.
  - [3aa8411](https://github.com/tauri-apps/winres/commit/3aa84115f6a80d74fd28f4f8c81ef734ccb1c37e) refactor: Use embed-resource crate to compile resources ([#9](https://github.com/tauri-apps/winres/pull/9)) on 2023-05-04

## \[0.1.0]

- Initial release.
  - [72e3fec](https://github.com/tauri-apps/winres/commit/72e3fecc69ad4fe6eaabc53a3f714d1ef6d39ad8) ci: Add covector to prepare publishing ([#5](https://github.com/tauri-apps/winres/pull/5)) on 2023-01-19
