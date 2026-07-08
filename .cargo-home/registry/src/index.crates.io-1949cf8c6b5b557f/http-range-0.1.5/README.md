# rust-http-range

HTTP Range header parser. It parses Range HTTP header string as per RFC 2616.

Inspired by Go's net/http library.

## Overview

Example usage:

```rust
extern crate http_range;

use http_range::{HttpRange};

fn main() {
    let range_str = "bytes=0-8";
    let size = 10;

    match HttpRange::parse(range_str, size) {
        Ok(rngs) => for r in rngs {
            println!("Start {}, length {}", r.start, r.length)
        },
        Err(err) => println!("HttpRange parse error: {:?}", err)
    };
}
```

## Used in

- [iron-send-file](https://github.com/bancek/iron-send-file)

## Author

Luka Zakrajšek

## License

MIT
