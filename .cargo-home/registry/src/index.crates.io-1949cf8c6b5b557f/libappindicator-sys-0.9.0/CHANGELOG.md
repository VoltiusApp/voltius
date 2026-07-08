# Changelog

## \[0.9.0]

- [`d07334b`](https://github.com/tauri-apps/libappindicator-rs/commit/d07334b2378b137505bbdd706c23803073483e2c) Update gtk to 0.18.

  Increase MSRV to 1.70.0.

## \[0.8.0]

- Bump gtk vesion: 0.15 -> 0.16
  - [f834d40](https://github.com/tauri-apps/libappindicator-rs/commit/f834d403fb44125d20f9c6f8f9a8d54aedef4451) chore: add changelog on 2023-01-25

## \[0.7.3]

- Load exclusively using dynamic linking

This change lets `dlopen` (through `ld.so`) handle what paths to search in for the respective libraries.
Additionally this fixes a mistake with the library filenames. Now using the `SONAME` instead of a symlinked name that happened to work when dev packages are installed.

**Breaking:** Support for `$APPDIR` based appImage detection is removed.
Though it *should* still work, because appimages provide an `LD_LIBRARY_PATH` that would be equivalent to what our previous detection method was doing in rust.

- [bb8d280](https://github.com/tauri-apps/libappindicator-rs/commit/bb8d2806b028c5b19c89f126624c85746fca9d7d) Add changes on 2022-06-27
- [aae5895](https://github.com/tauri-apps/libappindicator-rs/commit/aae5895ae389fc2c8a9542a1b630f36e22bcc582) Add a backcompat feature flag on 2022-06-28
- [7f96c33](https://github.com/tauri-apps/libappindicator-rs/commit/7f96c33637886e16082758c9e37a1ee6513ccbd2) fix(covector): change bump to patch on 2022-06-28

## \[0.7.2]

- Change the library loader to use the `APPDIR` environment variable if the running application is an AppImage file.
  - [3ee8dc0](https://github.com/tauri-apps/libappindicator-rs/commit/3ee8dc053e4a6027a215ad56dbf9fd4de758e297) fix(sys): use `APPDIR` environment variable when running as an appimage on 2022-06-03

## \[0.7.1]

- Load the library dynamically.
  - [3b44230](https://github.com/tauri-apps/libappindicator-rs/commit/3b442309396ab56f1ca4a2fb54477e8351e06f3f) Add change file and fmt on 2022-05-27

## \[0.7.0]

- Update to gtk 0.15
  - [ae54bef](https://github.com/tauri-apps/libappindicator-rs/commit/ae54bef8d37f508174c0995f6a9f4b6288107cbd) Update to gtk 0.15 on 2022-01-17

## \[0.6.1]

- Update license to Apache-2.0 OR MIT.
  - [09697b3](https://github.com/tauri-apps/libappindicator-rs/commit/09697b31188818260275b5ac99ea701c8351d3cd) Update license to Apache2/MIT on 2021-10-13

## \[0.6.0]

- Bump version of sys crate.
  - [c31ffa9](https://github.com/tauri-apps/libappindicator-rs/commit/c31ffa987503762f8a39664fe333af20d7862a9d) Bump version of sys crate on 2021-10-11
