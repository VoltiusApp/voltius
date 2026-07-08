# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.8.1 (2026-03-31)
### Added
- Impl `CtAssign(Slice)`/`CtEq(Slice)` for `EncodedPoint` ([#2269])

[#2269]: https://github.com/RustCrypto/formats/pull/2269

## 0.8.0 (2026-03-10)
### Added
- `ctutils` feature ([#2150])

### Changed
- Migrate from `generic-array` to `hybrid-array` ([#1298])
- Use `core::error::Error` ([#1573])
- Blanket impl `ModulusSize` for all typenums ([#1650])
- Upgrade to edition 2024; bump MSRV to 1.85 ([#1666])
- Bump `serdect` to v0.4 ([#2008])
- Bump `base16ct` to v1 ([#2145])
- Bump `der` to v0.8 ([#2234])

### Removed
- Integration with `pkcs8` crate ([#1927])

[#1298]: https://github.com/RustCrypto/formats/pull/1298
[#1573]: https://github.com/RustCrypto/formats/pull/1573
[#1650]: https://github.com/RustCrypto/formats/pull/1650
[#1666]: https://github.com/RustCrypto/formats/pull/1666
[#1927]: https://github.com/RustCrypto/formats/pull/1927
[#2008]: https://github.com/RustCrypto/formats/pull/2008
[#2145]: https://github.com/RustCrypto/formats/pull/2145
[#2150]: https://github.com/RustCrypto/formats/pull/2150
[#2234]: https://github.com/RustCrypto/formats/pull/2234

## 0.7.3 (2023-07-16)
### Added
- Impl `Hash` for `EncodedPoint` ([#1102])

[#1102]: https://github.com/RustCrypto/formats/pull/1102

## 0.7.2 (2023-04-09)
### Added
- Impl `ModulusSize` for `U24` ([#995])

[#995]: https://github.com/RustCrypto/formats/pull/995

## 0.7.1 (2023-02-27)
### Fixed
- Encode `ECPrivateKey` version ([#908])

[#908]: https://github.com/RustCrypto/formats/pull/908

## 0.7.0 (2023-02-26) [YANKED]
### Changed
- MSRV 1.65 ([#805])
- Bump `serdect` to v0.2 ([#893])
- Bump `der` dependency to v0.7 ([#899])
- Bump `spki` dependency to v0.7 ([#900])
- Bump `pkcs8` to v0.10 ([#902])

[#805]: https://github.com/RustCrypto/formats/pull/805
[#893]: https://github.com/RustCrypto/formats/pull/893
[#899]: https://github.com/RustCrypto/formats/pull/899
[#900]: https://github.com/RustCrypto/formats/pull/900
[#902]: https://github.com/RustCrypto/formats/pull/902

## 0.6.0 (Skipped)
- Skipped to synchronize version number with `der` and `spki`

## 0.5.0 (Skipped)
- Skipped to synchronize version number with `der` and `spki`

## 0.4.0 (Skipped)
- Skipped to synchronize version number with `der` and `spki`

## 0.3.0 (2022-05-08)
### Added
- Make `der` feature optional but on-by-default ([#497])
- Make `point` feature optional but on-by-default ([#516])

### Changed
- Use `base16ct` and `serdect` crates ([#648])
- Bump `der` to v0.6 ([#653])
- Bump `pkcs8` to v0.9 ([#656])

[#497]: https://github.com/RustCrypto/formats/pull/497
[#516]: https://github.com/RustCrypto/formats/pull/516
[#648]: https://github.com/RustCrypto/formats/pull/648
[#653]: https://github.com/RustCrypto/formats/pull/653
[#656]: https://github.com/RustCrypto/formats/pull/656

## 0.2.1 (2021-11-18)
### Added
- `serde` feature ([#248])
- Hexadecimal serialization/deserialization support for `EncodedPoint` ([#248])

[#248]: https://github.com/RustCrypto/formats/pull/248

## 0.2.0 (2021-11-17) [YANKED]
### Added
- `pkcs8` feature ([#229])

### Changed
- Rename `From/ToEcPrivateKey` => `DecodeEcPrivateKey`/`EncodeEcPrivateKey` ([#122])
- Use `der::Document` to impl `EcPrivateKeyDocument` ([#133])
- Rust 2021 edition upgrade; MSRV 1.56 ([#136])
- Bump `der` crate dependency to v0.5 ([#222])

### Removed
- I/O related errors ([#158])

[#122]: https://github.com/RustCrypto/formats/pull/122
[#133]: https://github.com/RustCrypto/formats/pull/133
[#136]: https://github.com/RustCrypto/formats/pull/136
[#158]: https://github.com/RustCrypto/formats/pull/158
[#222]: https://github.com/RustCrypto/formats/pull/222
[#229]: https://github.com/RustCrypto/formats/pull/229

## 0.1.0 (2021-09-22)
- Initial release
