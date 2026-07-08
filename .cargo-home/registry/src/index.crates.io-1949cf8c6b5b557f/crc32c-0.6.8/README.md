# CRC32C

[![Crates.io](https://img.shields.io/crates/v/crc32c.svg)](https://crates.io/crates/crc32c)
[![Docs.rs](https://docs.rs/crc32c/badge.svg)](https://docs.rs/crc32c/)
[![Travis](https://travis-ci.org/zowens/crc32c.svg?branch=master)](https://travis-ci.org/zowens/crc32c/)

Rust implementation of the CRC-32-Castagnoli algorithm with hardware acceleration where possible.

Hardware acceleration on the following architectures:
1. **x84-64** with [SSE 4.2](https://software.intel.com/sites/default/files/m/8/b/8/D9156103.pdf)
    * All stable versions of Rust
    * If SSE 4.2 is enabled at compile time, it will only build the SSE implementation. Otherwise, the `cpuid` is used to find the best implementation at runtime.
1. **aarch64** with [crc feature](https://developer.arm.com/documentation/dui0801/g/A32-and-T32-Instructions/CRC32C)
    * Only available on rust version >= 1.80.0 or nightly

All other processors utilize a software fallback.

## Usage

First, add this to your `Cargo.toml`:

```toml
[dependencies]
crc32c = "0.6"
```

```rust
extern crate crc32c;

fn main() {
    let message = b"Hello world!";
    let crc = crc32c::crc32c(message);

    println!("hash = {}", crc);
}
```

## License
You may use this code under either the [Apache 2.0 license](https://www.apache.org/licenses/LICENSE-2.0)
or the [MIT license](https://opensource.org/licenses/MIT), at your option.
