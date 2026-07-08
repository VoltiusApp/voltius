# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.2.3 (2026-05-10)
### Added
- `MaybeBox` type ([#309])

[#309]: https://github.com/RustCrypto/KEMs/pull/309

## 0.2.2 (2026-04-28)
### Fixed
- Avoid UDIV in compiled output on ARM targets ([#289])

[#289]: https://github.com/RustCrypto/KEMs/pull/289

## 0.2.1 (2026-04-03)
### Added
- Impl `ctutils::CtEq` for `Polynomial`, `Vector`, and `NttMatrix` ([#285])

[#285]: https://github.com/RustCrypto/KEMs/pull/285

## 0.2.0 (2026-03-26)
### Changed
- Migrate from `subtle` to `ctutils` ([#277])

### Removed
- `subtle` support ([#277])

[#277]: https://github.com/RustCrypto/KEMs/pull/277

## 0.1.0 (2026-02-05)
Initial release
