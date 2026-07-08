# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.2.0 (2026-03-16)

### Added
- `keccak_backend` configuration parameter with `aarch64_sha3`, `simd128`,
  `simd256`, `simd512`, and `soft` values ([#105], [#106], [#113])
- `Keccak` struct with a closure-based API for a more efficient access to
  supported backends ([#113])

### Changed
- Edition changed to 2024 and MSRV bumped to 1.85 ([#89])
- Bump `cpufeatures` dependency to v0.3 ([#99])
- AArch64 ASM backend is re-implemented using intrinsics (note that it's still
  enabled by default on AArch64 targets behind target feature auto-detection) ([#112])

### Removed
- `asm`, `simd`, and `no_unroll` crate features in favor of `keccak_backend`
  and `keccak_backend_soft` configuration parameters ([#105], [#106], [#113])
- `f1600` and `p1600` functions in favor of the `Keccak` struct ([#113])

### Fixed
- Use `doc_cfg` in place of removed `doc_auto_cfg` feature ([#91])

[#89]: https://github.com/RustCrypto/sponges/pull/89
[#91]: https://github.com/RustCrypto/sponges/pull/91
[#99]: https://github.com/RustCrypto/sponges/pull/99
[#105]: https://github.com/RustCrypto/sponges/pull/105
[#106]: https://github.com/RustCrypto/sponges/pull/106
[#112]: https://github.com/RustCrypto/sponges/pull/112
[#113]: https://github.com/RustCrypto/sponges/pull/113

## 0.1.6 (2026-02-13)
### Fixed
- ARMv8 `asm!` invocation had incorrect operand type ([#103])

[#103]: https://github.com/RustCrypto/sponges/pull/103

## 0.1.5 (2024-01-12)
### Changed
- Enable ARMv8 ASM backend for `p1600` ([#68])

[#68]: https://github.com/RustCrypto/sponges/pull/68

## 0.1.4 (2023-05-04)
### Added
- `keccak_p` fns for `[200, 400, 800, 1600]` ([#55])

### Changed
- 2018 edition upgrade ([#32])

[#32]: https://github.com/RustCrypto/sponges/pull/32
[#55]: https://github.com/RustCrypto/sponges/pull/55

## 0.1.3 (2022-11-14)
### Added
- ARMv8 SHA3 ASM intrinsics implementation for `keccak_f1600` ([#23])

[#23]: https://github.com/RustCrypto/sponges/pull/23

## 0.1.2 (2022-05-24)
### Changed
- Implement `simd` feature with  `portable_simd` instead of deprecated `packed_simd` ([#16])

[#16]: https://github.com/RustCrypto/sponges/pull/16

## 0.1.1 (2022-05-24)
### Added
- Generic keccak-p and keccak-f {200, 400, 800} ([#7])
- f1600x{2, 4, 8} ([#8])

[#7]: https://github.com/RustCrypto/sponges/pull/7
[#8]: https://github.com/RustCrypto/sponges/pull/8

## 0.1.0 (2018-03-27)
- Initial release
