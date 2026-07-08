<div class="rustdoc-hidden">

# jsonptr - JSON Pointers (RFC 6901) for Rust

</div>

[<img alt="github" src="https://img.shields.io/badge/github-chanced/jsonptr-62D1FC?style=for-the-badge&labelColor=777&logo=github" height="21">](https://github.com/chanced/jsonptr)
[<img alt="crates.io" src="https://img.shields.io/crates/v/jsonptr.svg?style=for-the-badge&color=fc8d62&logo=rust" height="21">](https://crates.io/crates/jsonptr)
[<img alt="docs.rs" src="https://img.shields.io/badge/docs.rs-jsonptr-f0f0f0?style=for-the-badge&labelColor=777&logo=docs.rs" height="21">](https://docs.rs/jsonptr)
[<img alt="build status" src="https://img.shields.io/github/actions/workflow/status/chanced/jsonptr/test.yml?branch=main&style=for-the-badge" height="21">](https://github.com/chanced/jsonptr/actions?query=branch%3Amain)
[<img alt="code coverage" src="https://img.shields.io/codecov/c/github/chanced/jsonptr?style=for-the-badge&color=CBB88D" height="21">](https://codecov.io/gh/chanced/jsonptr)

JSON Pointers ([RFC 6901](https://datatracker.ietf.org/doc/html/rfc6901))
defines a string syntax for identifying a specific location within a JSON, or
similar, document. This crate provides two types, [`Pointer`] and [`PointerBuf`]
(akin to [`Path`] and [`PathBuf`]), for working with them abstractly.

A pointer is composed of zero or more [`Token`]s, single segments which
represent a field of an object or an [`index`] of an array, and are bounded by
either `'/'` or the end of the string. Tokens are lightly encoded, where `'~'`
is escaped as `"~0"` due to it signaling encoding and `'/'` is escaped as `"~1"`
because `'/'` separates tokens and would split the token into two otherwise.

[`Token`]s can be iterated over using either [`Tokens`], returned from the
[`tokens`] method of a pointer or [`Components`], returned from the
[`components`] method. The difference being that `Tokens` iterates over each
token in the pointer, while `Components` iterates over [`Component`]s, which can
represent the root of the document or a single token of the pointer.

Operations [`resolve`], [`assign`] and [`delete`] are provided as traits with
corresponding methods on pointer types. Implementations of each trait are
provided for value types of the crates [`serde_json`] and [`toml`]. All
operations are enabled by default but are gated by [feature
flags](#feature-flags).

## Usage

To parse a [`Pointer`] from a string, use either [`Pointer::parse`], for
potentially fallible parsing, or the `const fn` `from_static` to produce a
`&'static Pointer` from a string that is known to be valid.

```rust
use jsonptr::Pointer;

let ptr = Pointer::parse("/examples/0/name").unwrap();
let static_ptr = Pointer::from_static("/examples/0/name");
assert_eq!(ptr, static_ptr);

let parent = ptr.parent().unwrap();
assert_eq!(parent, Pointer::parse("/examples/0").unwrap());

let (token, remaining) = ptr.split_front().unwrap();
assert_eq!(token.decoded(), "examples");
assert_eq!(remaining, Pointer::parse("/0/name").unwrap());
```

[`PointerBuf`]s can be parsed using [`PointerBuf::parse`] or constructed from an
iterator of [`Token`]s with the [`from_tokens`] method:

```rust
use jsonptr::PointerBuf;
let mut buf = PointerBuf::parse("/examples/0/name").unwrap();

let from_tokens = PointerBuf::from_tokens(["examples", "0", "name"]);
assert_eq!(&buf, &from_tokens);

buf.push_front("pointer");
buf.push_front("~");
buf.push_back("/");
assert_eq!(buf.as_str(), "/~0/pointer/examples/0/name/~1");
```

Iterating over the tokens or components of a pointer:

```rust
use jsonptr::{Pointer, Component, Token};
let ptr = Pointer::from_static("/path/to/value");

//  Using the `tokens` method:
let tokens: Vec<_> = ptr.tokens().collect();
assert_eq!(tokens, vec![Token::new("path"), Token::new("to"), Token::new("value")]);

// Using the `components` method:
let mut components = ptr.components();
assert_eq!(components.next(), Some(Component::Root));
assert_eq!(components.next(), Some(Component::Token(Token::new("path"))));
assert_eq!(components.next(), Some(Component::Token(Token::new("to"))));
assert_eq!(components.next(), Some(Component::Token(Token::new("value"))));
```

To get a value at the location of a pointer, use either the [`Resolve`] and
[`ResolveMut`] traits or [`Pointer::resolve`] and [`Pointer::resolve_mut`]
methods. See the [`resolve`] mod for more information.

```rust
use jsonptr::Pointer;
use serde_json::json;

let ptr = Pointer::parse("/foo/bar").unwrap();
let data = json!({"foo": { "bar": 34 }});
let bar = ptr.resolve(&data).unwrap();
assert_eq!(bar, &json!(34));
```

Values can be set, with path expansion, using the either the [`Assign`] trait or
[`Pointer::assign`]. See [`assign`] for more information.

```rust
use jsonptr::Pointer;
use serde_json::json;

let ptr = Pointer::parse("/secret/universe").unwrap();
let mut data = json!({"secret": { "universe": 42 }});
let replaced = ptr.assign(&mut data, json!(34)).unwrap();
assert_eq!(replaced, Some(json!(42)));
assert_eq!(data, json!({"secret": { "universe": 34 }}));
```

Values can be removed with the either the [`Delete`] trait or
[`Pointer::delete`]. See [`delete`] for more information.

```rust
use jsonptr::Pointer;
use serde_json::json;

let ptr = Pointer::parse("/secret/universe").unwrap();
let mut data = json!({"secret": { "universe": 42 }});
let replaced = ptr.assign(&mut data, json!(34)).unwrap();
assert_eq!(replaced, Some(json!(42)));
assert_eq!(data, json!({"secret": { "universe": 34 }}));
```

## Feature Flags

|    Flag     | Description                                                                                                                               | Enables         | Default |
| :---------: | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------- | :-----: |
|   `"std"`   | Implements `std::error::Error` for error types                                                                                            |                 |    ✓    |
|  `"serde"`  | Enables [`serde`] support for types                                                                                                       |                 |    ✓    |
|  `"json"`   | Implements ops for [`serde_json::Value`]                                                                                                  | `"serde"`       |    ✓    |
|  `"toml"`   | Implements ops for [`toml::Value`]                                                                                                        | `"std"`, `toml` |         |
| `"assign"`  | Enables the [`assign`] module and related pointer methods, providing a means to assign a value to a specific location within a document   |                 |    ✓    |
| `"resolve"` | Enables the [`resolve`] module and related pointer methods, providing a means to resolve a value at a specific location within a document |                 |    ✓    |
| `"delete"`  | Enables the [`delete`] module and related pointer methods, providing a means to delete a value at a specific location within a document   | `"resolve"`     |    ✓    |

<div class="rustdoc-hidden">

## License

Licensed under either of

-   Apache License, Version 2.0
    ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
-   MIT license
    ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)

at your convenience.

## Contribution

Contributions and feedback are always welcome and appreciated. If you find an
issue, please open a ticket or a pull request.

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.

[LICENSE-APACHE]: LICENSE-APACHE
[LICENSE-MIT]: LICENSE-MIT

</div>

[`Pointer::components`]: https://docs.rs/jsonptr/latest/jsonptrstruct.Pointer.html#method.components
[`Pointer::tokens`]: https://docs.rs/jsonptr/latest/jsonptrstruct.Pointer.html#method.tokens
[`Pointer`]: https://docs.rs/jsonptr/latest/jsonptr/struct.Pointer.html
[`Pointer::parse`]: https://docs.rs/jsonptr/latest/jsonptr/struct.Pointer.html#method.parse
[`Pointer::resolve`]: https://docs.rs/jsonptr/latest/jsonptr/struct.Pointer.html#method.resolve
[`Pointer::resolve_mut`]: https://docs.rs/jsonptr/latest/jsonptr/struct.Pointer.html#method.resolve_mut
[`Pointer::assign`]: https://docs.rs/jsonptr/latest/jsonptr/struct.Pointer.html#method.assign
[`Pointer::delete`]: https://docs.rs/jsonptr/latest/jsonptr/struct.Pointer.html#method.delete
[`PointerBuf::parse`]: https://docs.rs/jsonptr/latest/jsonptr/struct.PointerBuf.html#method.parse
[`from_tokens`]: https://docs.rs/jsonptr/latest/jsonptr/struct.PointerBuf.html#method.from_tokens
[`PointerBuf`]: https://docs.rs/jsonptr/latest/jsonptr/struct.PointerBuf.html
[`Token`]: https://docs.rs/jsonptr/latest/jsonptr/struct.Token.html
[`Tokens`]: https://docs.rs/jsonptr/latest/jsonptr/struct.Tokens.html
[`Components`]: https://docs.rs/jsonptr/latest/jsonptr/struct.Components.html
[`Component`]: https://docs.rs/jsonptr/latest/jsonptr/enum.Component.html
[`index`]: https://docs.rs/jsonptr/latest/jsonptr/index/index.html
[`tokens`]: https://docs.rs/jsonptr/latest/jsonptr/struct.Pointer.html#method.tokens
[`components`]: https://docs.rs/jsonptr/latest/jsonptr/struct.Pointer.html#method.components
[`resolve`]: https://docs.rs/jsonptr/latest/jsonptr/resolve/index.html
[`assign`]: https://docs.rs/jsonptr/latest/jsonptr/assign/index.html
[`delete`]: https://docs.rs/jsonptr/latest/jsonptr/delete/index.html
[`Resolve`]: https://docs.rs/jsonptr/latest/jsonptr/resolve/trait.Resolve.html
[`ResolveMut`]: https://docs.rs/jsonptr/latest/jsonptr/resolve/trait.ResolveMut.html
[`Assign`]: https://docs.rs/jsonptr/latest/jsonptr/assign/trait.Assign.html
[`Delete`]: https://docs.rs/jsonptr/latest/jsonptr/delete/trait.Delete.html
[`serde`]: https://docs.rs/serde/1.0/serde/index
[`serde_json`]: https://docs.rs/serde_json/1.0/serde_json/enum.Value.html
[`serde_json::Value`]: https://docs.rs/serde_json/1.0/serde_json/enum.Value.html
[`toml`]: https://docs.rs/toml/0.8/toml/enum.Value.html
[`toml::Value`]: https://docs.rs/toml/0.8/toml/enum.Value.html
[`Path`]: https://doc.rust-lang.org/std/path/struct.Path.html
[`PathBuf`]: https://doc.rust-lang.org/std/path/struct.PathBuf.html
