Keyboard Types
==============

[![Build Status](https://github.com/pyfisch/keyboard-types/actions/workflows/ci.yml/badge.svg)](https://github.com/pyfisch/keyboard-types/actions/workflows/ci.yml)
[![Crates.io](https://img.shields.io/crates/v/keyboard-types.svg)](https://crates.io/crates/keyboard-types)
[![Documentation](https://docs.rs/keyboard-types/badge.svg)](https://docs.rs/keyboard-types)

Contains types to define keyboard related events.

The naming and conventions follow the UI Events specification
but this crate should be useful for anyone implementing keyboard
input in a cross-platform way.

See also: [UI Events Specification](https://w3c.github.io/uievents/)

Updating Generated Code
-----------------------

The file `src/key.rs` and `src/code.rs` are derived from the two 
W3C working drafts

* [UI Events KeyboardEvent key Values](https://w3c.github.io/uievents-key/) and
* [UI Events KeyboardEvent code Values](https://w3c.github.io/uievents-code/)

in the most recent version. A Python 3 script (requires `requests` library)
downloads the files and updates the tables.

Manually check if any modifier keys were changed and update the
`src/modifiers.rs` file if necessary.

