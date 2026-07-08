Byte Unit
====================

[![CI](https://github.com/magiclen/Byte-Unit/actions/workflows/ci.yml/badge.svg)](https://github.com/magiclen/Byte-Unit/actions/workflows/ci.yml)

A library for interaction with units of bytes.

The units are **B** for 1 byte, **KB** for 1000 bytes, **MiB** for 1048576 bytes, **GB** for 1000000000 bytes, etc, and up to **E** or **Y** (if the `u128` feature is enabled).

## Usage

The data types for storing the size in bits/bytes are `u64` by default, meaning the highest supported unit is up to **E**. If the `u128` feature is enabled, the data types will use `u128`, increasing the highest supported unit up to **Y**.

### Unit

The enum `Unit` can be used for representing the unit of bits/bytes.

```rust
use byte_unit::Unit;

assert_eq!("KB", Unit::KB.as_str());
assert_eq!("MiB", Unit::MiB.as_str());

assert_eq!(Unit::KB, Unit::parse_str("K", true, true).unwrap());
assert_eq!(Unit::Kbit, Unit::parse_str("K", true, false).unwrap());

assert_eq!(Unit::KB, Unit::parse_str("KB", true, true).unwrap());
assert_eq!(Unit::KB, Unit::parse_str("Kb", true, true).unwrap());
assert_eq!(Unit::Kbit, Unit::parse_str("Kbit", true, true).unwrap());

assert_eq!(Unit::KB, Unit::parse_str("KB", false, true).unwrap());
assert_eq!(Unit::Kbit, Unit::parse_str("Kb", false, true).unwrap());
```

### Byte

The `Byte` struct can be used for representing a size in bytes.

The `from_*` associated functions can be used to create a `Byte` instance from different data types.  The `as_*` methods can retrieve the size as a primitive type.

```rust
use byte_unit::{Byte, Unit};

assert_eq!(15000, Byte::from_u64(15000).as_u64());
assert_eq!(15000, Byte::from_u64_with_unit(15, Unit::KB).unwrap().as_u64());
```

You can also parse a string to create a `Byte` instance.

```rust
use byte_unit::Byte;

assert_eq!(50840000, Byte::parse_str("50.84 MB", true).unwrap().as_u64());
```

A `Byte` instance can be formatted to string precisely. For more detailed usage, please refer to the implementation documentation of `Display::fmt` for `Byte`.

```rust
use byte_unit::Byte;

let byte = Byte::from_u64(15500);

assert_eq!("15500", byte.to_string());

assert_eq!("15.5 KB", format!("{byte:#}"));
assert_eq!("15500 B", format!("{byte:#.0}"));
```

#### Arithmetic

There are `add`, `subtract`, `multiply`, and `divide` methods.

```rust
use byte_unit::Byte;

let a = Byte::from_u64(15500);
let b = Byte::from_u64(500);

assert_eq!(16000, a.add(b).unwrap().as_u64());
assert_eq!(15000, a.subtract(b).unwrap().as_u64());

assert_eq!(31000, a.multiply(2).unwrap().as_u64());
assert_eq!(3100, a.divide(5).unwrap().as_u64());
```

#### Find Out an Appropriate Unit

The `get_exact_unit` and `get_recoverable_unit` methods is useful if you want to find out a unit that is appropriate for a `Byte` instance.

```rust
use byte_unit::{Byte, Unit};

let byte = Byte::from_u64(50840000);

assert_eq!((50840, Unit::KB), byte.get_exact_unit(false));
assert_eq!((50.84f64.try_into().unwrap(), Unit::MB), byte.get_recoverable_unit(false, 2));
assert_eq!((50840.into(), Unit::KB), byte.get_recoverable_unit(false, 0));
```

#### AdjustedByte

The `AdjustedByte` struct can be used for roughly representing a size of bytes with a unit.

To change the unit of a `Byte` instance, you can use the `get_adjusted_unit` method.

An `AdjustedByte` instance can be formatted to string. For more detailed usage, please refer to the implementation documentation of `Display::fmt` for `AdjustedByte`.

```rust
use byte_unit::{Byte, Unit};

let byte = Byte::parse_str("123KiB", true).unwrap();

let adjusted_byte = byte.get_adjusted_unit(Unit::KB);

assert_eq!("125.952 KB", adjusted_byte.to_string());
assert_eq!("125.95 KB", format!("{adjusted_byte:.2}"));
```

The `get_appropriate_unit` method can be used to automatically find an appropriate unit for creating an `AdjustedByte` instance.

```rust
use byte_unit::{Byte, Unit, UnitType};

let byte = Byte::from_u64(1500000);

let adjusted_byte = byte.get_appropriate_unit(UnitType::Binary);

assert_eq!("1.43 MiB", format!("{adjusted_byte:.2}"));
```

### Bit

The `Bit` struct can be used for representing a size in bits.

The `bit` feature must be enabled.

Usage of the `Bit` struct and the `Byte` struct is very similar. Also, There is the `AdjustedBit` struct. The difference lies in the fact that the `parse_str` method of the `Bit` struct cannot be configured to ignore case; it always does not ignore case.

```rust
use byte_unit::{Bit, Unit};

let bit = Bit::parse_str("123Kib").unwrap();

let adjusted_bit = bit.get_adjusted_unit(Unit::Kbit);

assert_eq!("125.952 Kb", adjusted_bit.to_string());
assert_eq!("125.95 Kb", format!("{adjusted_bit:.2}"));
```

## No Std

Disable the default features to compile this crate without std.

```toml
[dependencies.byte-unit]
version = "*"
default-features = false
features = ["byte"]
```

## Serde Support

Enable the `serde` feature to support the serde framework.

```toml
[dependencies.byte-unit]
version = "*"
features = ["serde"]
```

## Schemars Support

Enable the `schemars` feature to support Schemars. Probably the `serde` feature is also needed.

```toml
[dependencies.byte-unit]
version = "*"
features = ["serde", "schemars"]
```

## Rocket Support

Enable the `rocket` feature to support the Rocket framework.

```toml
[dependencies.byte-unit]
version = "*"
features = ["rocket"]
```

## Crates.io

https://crates.io/crates/byte-unit

## Documentation

https://docs.rs/byte-unit

## License

[MIT](LICENSE)
