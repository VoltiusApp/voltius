[![Crates.io](https://img.shields.io/crates/v/generic-array.svg)](https://crates.io/crates/generic-array)
[![Build Status](https://github.com/fizyk20/generic-array/actions/workflows/CI.yml/badge.svg)](https://github.com/fizyk20/generic-array/actions/workflows/CI.yml)
![Rust Version](https://img.shields.io/badge/rustc-1.65+-blue.svg)

# generic-array

This crate implements a structure that can be used as a generic array type.

**Requires minimum Rust version of 1.65.0

[Documentation on GH Pages](https://fizyk20.github.io/generic-array/generic_array/) may be required to view certain types on foreign crates.

## Upgrading from 0.14 or using with `hybrid-array 0.4`

`generic-array 0.14` has been officially deprecated, so here's a quick guide on how to upgrade from `generic-array 0.14` to `1.x`. Note that libraries depending on `generic-array` will need to update their usage as well. Some libraries are moving to `hybrid-array 0.4` instead, which we provide interoperability with `generic-array 1.x` via the `hybrid-array-0_4` feature flag.

<details>
<summary>Click to expand</summary>

To upgrade to `1.x`, change your `Cargo.toml` to use the new version:

```toml
[dependencies]
generic-array = "1"
```

then in your code, go through and remove the `<T>` from `ArrayLength<T>` bounds, as the type parameter has been removed. It's now just `ArrayLength`.

If you _need_ to interoperate with `generic-array 0.14`, enable the `compat-0_14` feature flag:

```toml
[dependencies]
generic-array = { version = "1", features = ["compat-0_14"] }
```

then use the `to_0_14`/`from_0_14`/`as_0_14`/`as_0_14_mut` methods on `GenericArray` to convert between versions, or use the `From`/`AsRef`/`AsMut` implementations.

The `arr!` macro has changed to no longer require a type parameter, so change:

```rust
let array = arr![i32; 1, 2, 3];
// to
let array = arr![1, 2, 3];
```

For interoperability with `hybrid-array 0.4`, enable the `hybrid-array-0_4` feature flag:

```toml
[dependencies]
generic-array = { version = "1", features = ["hybrid-array-0_4"] }
```

then use the `to_ha0_4`/`from_ha0_4`/`as_ha0_4`/`as_ha0_4_mut` methods on `GenericArray` to convert between versions, or use the `From`/`AsRef`/`AsMut` implementations.

We also implement the `AssocArraySize` and `AsArrayRef`/`AsArrayMut` traits from `hybrid-array` for `GenericArray`.

</details>

## Usage

Before Rust 1.51, arrays `[T; N]` were problematic in that they couldn't be generic with respect to the length `N`, so this wouldn't work:

```rust
struct Foo<N> {
    data: [i32; N],
}
```

Since 1.51, the below syntax is valid:

```rust
struct Foo<const N: usize> {
    data: [i32; N],
}
```

However, the const-generics we have as of writing this are still the minimum-viable product (`min_const_generics`), so many situations still result in errors, such as this example:

```rust
trait Bar {
    const LEN: usize;

    // Error: cannot perform const operation using `Self`
    fn bar(&self) -> Foo<{ Self::LEN }>;
}
```

**generic-array** defines a new trait `ArrayLength` and a struct `GenericArray<T, N: ArrayLength>`, which lets the above be implemented as:

```rust
struct Foo<N: ArrayLength> {
    data: GenericArray<i32, N>
}

trait Bar {
    type LEN: ArrayLength;
    fn bar(&self) -> Foo<Self::LEN>;
}
```

The `ArrayLength` trait is implemented for [unsigned integer types](http://fizyk20.github.io/generic-array/typenum/uint/index.html) from [typenum](http://fizyk20.github.io/generic-array/typenum/index.html) crate. For example, `GenericArray<T, U5>` would work almost like `[T; 5]`:

```rust
use generic_array::typenum::U5;

struct Foo<T, N: ArrayLength> {
    data: GenericArray<T, N>
}

let foo = Foo::<i32, U5> { data: GenericArray::default() };
```

The `arr!` macro is provided to allow easier creation of literal arrays, as shown below:

```rust
let array = arr![1, 2, 3];
//  array: GenericArray<i32, typenum::U3>
assert_eq!(array[2], 3);
```

## Feature flags

```toml
[dependencies.generic-array]
features = [
    "serde",            # Serialize/Deserialize implementation
    "zeroize",          # Zeroize implementation for setting array elements to zero
    "const-default",    # Compile-time const default value support via trait
    "alloc",            # Enables From/TryFrom implementations between GenericArray and Vec<T>/Box<[T]>
    "faster-hex",       # Enables internal use of the `faster-hex` crate for faster hex encoding via SIMD
    "subtle",           # Enables `subtle` crate support for constant-time equality checks and conditional selection
    "arbitrary",        # Enables `arbitrary` crate support for fuzzing
    "bytemuck",         # Enables `bytemuck` crate support
    "bitvec",           # Enables `bitvec` crate support to use GenericArray as a storage backend for bit arrays
    "compat-0_14",      # Enables interoperability with `generic-array` 0.14
    "hybrid-array-0_4"  # Enables interoperability with `hybrid-array` 0.4
]
```