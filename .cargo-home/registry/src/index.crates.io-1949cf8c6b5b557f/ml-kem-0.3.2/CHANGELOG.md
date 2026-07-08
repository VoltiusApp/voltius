# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.3.2 (2026-05-10)
### Added
- Optional on-by-default heap offload support ([#310])

[#310]: https://github.com/RustCrypto/KEMs/pull/310

## 0.3.1
Skipped as it was tagged without a version bump.

## 0.3.0 (2026-04-28)
### Added
- `Seed` support e.g. `DecapsulationKey::from_seed` ([#133], [#138])
- PKCS#8 support ([#135])
- `KeyInit`, `KeySizeUser`, and `KeyExport` impls for decapsulation keys ([#156], [#228])
- Parameter set modules: `ml_kem_512`, `mk_kem_768`, `mk_kem_1024` ([#162])
- `DecapsulationKey::from_expanded` deprecated compatibility support ([#163])
- `TryKeyInit` and `KeyExport` impls for encapsulation keys ([#188])
- Validations against Wycheproof test vectors ([#213], [#214], [#215], [#217])
- Implement `kem::Kem` trait ([#223])
- Support for `kem::FromSeed` trait ([#255])

### Changed
- Edition changed to 2024 and MSRV bumped to 1.85 ([#118])
- Relax MSRV policy and allow MSRV bumps in patch releases
- Upgrade `hybrid-array` dependency to 0.4 ([#129])
- Extract `module-lattice` crate ([#199], [#202], [#204], [#209], [#210], [#211], [#212], [#218],
  [#219], [#220])
- Replace `EncodedSizeUser` with `ExpandedKeyEncoding` ([#226])
- Bump `getrandom` to v0.4 ([#245])
- Bump `rand_core` to v0.10 ([#245])
- Migrate from `subtle` to `ctutils` ([#277])
- Bump `sha3` dependency to v0.11 ([#282])
- Bump `kem` dependency to v0.3 ([#283])
- Bump `pkcs8` dependency to v0.11 ([#291])

### Fixed
- Validate encryption/encapsulation keys ([#179])
- Validate expanded decapsulation key hash ([#207])

### Removed
- `Kem` struct and `KemCore` trait - replaced by `kem::Kem` ([#223])

[#118]: https://github.com/RustCrypto/KEMs/pull/118
[#129]: https://github.com/RustCrypto/KEMs/pull/129
[#133]: https://github.com/RustCrypto/KEMs/pull/133
[#135]: https://github.com/RustCrypto/KEMs/pull/135
[#138]: https://github.com/RustCrypto/KEMs/pull/138
[#156]: https://github.com/RustCrypto/KEMs/pull/156
[#162]: https://github.com/RustCrypto/KEMs/pull/162
[#163]: https://github.com/RustCrypto/KEMs/pull/163
[#179]: https://github.com/RustCrypto/KEMs/pull/179
[#188]: https://github.com/RustCrypto/KEMs/pull/188
[#199]: https://github.com/RustCrypto/KEMs/pull/199
[#202]: https://github.com/RustCrypto/KEMs/pull/202
[#204]: https://github.com/RustCrypto/KEMs/pull/204
[#207]: https://github.com/RustCrypto/KEMs/pull/207
[#209]: https://github.com/RustCrypto/KEMs/pull/209
[#210]: https://github.com/RustCrypto/KEMs/pull/210
[#211]: https://github.com/RustCrypto/KEMs/pull/211
[#212]: https://github.com/RustCrypto/KEMs/pull/212
[#213]: https://github.com/RustCrypto/KEMs/pull/213
[#214]: https://github.com/RustCrypto/KEMs/pull/214
[#215]: https://github.com/RustCrypto/KEMs/pull/215
[#217]: https://github.com/RustCrypto/KEMs/pull/217
[#218]: https://github.com/RustCrypto/KEMs/pull/218
[#219]: https://github.com/RustCrypto/KEMs/pull/219
[#220]: https://github.com/RustCrypto/KEMs/pull/220
[#223]: https://github.com/RustCrypto/KEMs/pull/223
[#226]: https://github.com/RustCrypto/KEMs/pull/226
[#228]: https://github.com/RustCrypto/KEMs/pull/228
[#245]: https://github.com/RustCrypto/KEMs/pull/245
[#255]: https://github.com/RustCrypto/KEMs/pull/255
[#277]: https://github.com/RustCrypto/KEMs/pull/277
[#282]: https://github.com/RustCrypto/KEMs/pull/282
[#283]: https://github.com/RustCrypto/KEMs/pull/283
[#291]: https://github.com/RustCrypto/KEMs/pull/291

## 0.2.3 (2026-02-17)
### Fixed
- Use `doc_cfg` instead of `doc_auto_cfg` ([#265])

[#265]: https://github.com/RustCrypto/KEMs/pull/265

## 0.2.2 (2026-01-24)
### Changed
- Pin `kem` crate dependency to `=0.3.0-pre.0` ([#194])

[#194]: https://github.com/RustCrypto/KEMs/pull/194

## 0.2.1 (2024-08-17)
### Added
- `zeroize` feature ([#51])

[#51]: https://github.com/RustCrypto/KEMs/pull/51

## 0.2.0 (2024-08-16)
### Added
- `DecapsulationKey::encapsulation_key` ([#48])
- Re-export `kem::{Decapsulate, Encapsulate}` under `kem` module ([#49])
- Re-exports `hybrid-array` as `array` ([#49])

### Changed
- Update to FIPS 203 final ([#47])

[#47]: https://github.com/RustCrypto/KEMs/pull/47
[#48]: https://github.com/RustCrypto/KEMs/pull/48
[#49]: https://github.com/RustCrypto/KEMs/pull/49

## 0.1.1 (2024-06-04)
### Security
- Fix potential "Kyberslash" attack ([#18])

[#18]: https://github.com/RustCrypto/KEMs/pull/18

## 0.1.0 (2024-04-12)
- Initial release
