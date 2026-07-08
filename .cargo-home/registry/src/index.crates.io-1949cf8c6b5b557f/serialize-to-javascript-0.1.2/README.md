Serialize to JavaScript
=============

This library provides serialization from `serde::Serialize` into JavaScript utilizing `serde_json`. It also provides
a very simple templating mechanism along with derive macros to automatically derive them for suitable types.

```toml
[dependencies]
serialize-to-javascript = "0.1"
```

---

## Examples

### Serialization
```rust
use serialize_to_javascript::{Options, Serialized};

fn main() -> serialize_to_javascript::Result<()> {
    let raw_value = serde_json::value::to_raw_value("foo'bar")?;
    let serialized = Serialized::new(&raw_value, &Options::default());
    assert_eq!(serialized.into_string(), "JSON.parse('\"foo\\'bar\"')");
    Ok(())
}
```

### Templating

`main.rs`:
```rust
use serialize_to_javascript::{default_template, DefaultTemplate, Options, Serialized, Template};

#[derive(Template)]
#[default_template("keygen.js")]
struct Keygen<'a> {
    key: &'a str,
    length: usize,

    #[raw]
    optional_script: &'static str,
}

fn main() -> serialize_to_javascript::Result<()> {
    let keygen = Keygen {
        key: "asdf",
        length: 4,
        optional_script: "console.log('hello, from my optional script')",
    };

    let _output: Serialized = keygen.render_default(&Options::default())?;

    Ok(())
}
```

`keygen.js`:
```javascript
const keygenKey = __TEMPLATE_key__
const keygenLength = __TEMPLATE_length__

__RAW_optional_script__

// app logic, we are ensuring the length is equal to the expected one for some reason
if (keygenKey.length === keygenLength) {
    console.log("okay!")
} else {
    console.error("oh no!")
}
```

---

### License

Licensed under either of [Apache License 2.0](LICENSE-APACHE), Version or [MIT license](LICENSE-MIT) at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted  for inclusion in this crate by you,
as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.
