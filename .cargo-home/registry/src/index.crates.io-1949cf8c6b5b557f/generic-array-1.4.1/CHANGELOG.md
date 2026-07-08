* **`1.4.1`**
    * Fix some issues with using ZSTs with `Box<GenericArray<ZST, N>>`. Partial credit to [#166](https://github.com/fizyk20/generic-array/pull/166).

* **`1.4.0`**
    * Add `subtle`, `arbitrary`, `bytemuck`, `bitvec` and `as-slice` implementations for `GenericArray`.
    * Add `GenericSequence::repeat` for creating sequences/arrays with repeated elements.
    * Add `FallibleGenericSequence` with `try_generate` and `from_fallible_iter` for fallible generation of sequences/arrays.
        * Added `AllocError` type (requires `alloc` feature) for heap allocation failures with `try_generate`.
    * Add `try_fold` and `try_map` to `FunctionalSequence` for fallible folding/mapping of sequences/arrays.
    * Add `try_from_fallible_iter` to `GenericArray` for fallible construction from fallible iterators.
    * Add `each_ref`/`each_mut` methods to `GenericArray` for creating arrays of references to the elements.
    * Fixed some resource leakages and potential UB in degenerate cases.

* **`1.3.5`**
    * Fixed `const_transmute` not compiling between Rust versions 1.74.0 and 1.83.0. Yanked `1.3.4`.

* **`1.3.4`**
    * Significantly improve stack usage of `GenericArray` methods in unoptimized (`-C opt-level=0`) build modes.
    * Introduce the `hybrid-array-0_4` feature to allow interop between `generic-array` 1.x and `hybrid-array` 0.4 versions.
    * Add `ConstGenericArray` type alias for easier usage with literal const usizes.
    * Implement `ZeroizeOnDrop` for `GenericArray` when `T: ZeroizeOnDrop` (when using the `zeroize` feature).

* **`1.3.2`**
    * Introduce the `compat-0_14` feature to allow interop between `generic-array` 1.x and 0.14 versions.

* **`1.3.1`**
    * Lower MSRV to 1.65.0 (minimum required for GATs)
    * Make some functions `const` only on Rust 1.83.0 or newer, otherwise they are non-`const`.
    * Implement `core::error::Error` for `LengthError` on Rust 1.81.0 or newer.

* **`1.3.0`**
    * Restrict `ArrayLength` to lengths representable by `usize` to fix soundness issues [#156](https://github.com/fizyk20/generic-array/issues/156) (may break invalid code)
    * Flatten internal representation to improve miri performance [#157](https://github.com/fizyk20/generic-array/issues/157)
    * Use `serde_core` instead of `serde`

* **`1.2.1`**
    * Replace `doc_auto_cfg` with `doc_cfg` [#155](https://github.com/fizyk20/generic-array/pull/155)

* **`1.2.0`**
    * Mark more functions as `const`
    * Bump MSRV to 1.83.0 (reverted in `generic-array 1.3.1`)

* **`1.1.1`**
    * Add `Flatten` and `Unflatten` traits for converting between nested arrays.

* **`1.1.0`**
    * Add `Remove` trait that adds `remove`/`swap_remove` to `GenericArray` (inspired by [#147](https://github.com/fizyk20/generic-array/pull/147))
    * Soft-deprecate `internals::ArrayBuilder` in favor of `internals::IntrusiveArrayBuilder`

* **`1.0.1`**
    * Update faster-hex dependency
    * Mark `from_iter` as `#[inline]` to significantly improve codegen.

* **`1.0.0`**
    * **Use GATs for `ArrayLength`** !
    * Bump MSRV to 1.65.0
    * Use Rust 2021 edition [#118](https://github.com/fizyk20/generic-array/pull/118) + non-PR upgrade later with GATs.
    * Allow `arr!` macro in `const` [#129](https://github.com/fizyk20/generic-array/pull/129)
    * Add `arr!` repeat-expressions [#130](https://github.com/fizyk20/generic-array/pull/130)
    * Implement `const-default` trait support [#131](https://github.com/fizyk20/generic-array/pull/131)
    * Make `as_slice()/from_slice()` const.
    * Add const `from_array`/`into_array` methods.
    * Make `ArrayLength: 'static`
    * Replace `From<&[T]>` with `TryFrom<&[T]>`
    * Add `try_from_iter` for fallible construction from iterator.
    * Use `typenum`'s `const-generics` feature for `const N: usize`-based `From` implementations between `[T; N]` and `GenericArray<T, N>`
        * Also added the `IntoArrayLength` trait and `ConstArrayLength` type-alias for working with typenum's `Const<N>` easier.
    * `alloc` crate feature
        * Added `box_arr!` macro with the same syntax as `arr!`, but returns a `Box<GenericArray<T, N>>`
        * Moving between heap and stack
            * `impl TryFrom<Vec<T>> for GenericArray<T, N>`
            * `impl TryFrom<Box<[T]>> for GenericArray<T, N>`
            * `impl From<GenericArray<T, N>> for Vec<T>`
            * `impl From<GenericArray<T, N>> for Box<[T]>`
        * Methods for converting between `Box<GenericArray<T, N>>` and `Vec<T>`/`Box<[T]>`
        * `GenericSequence` and `FunctionalSequence` implemented for `Box<GenericArray<T, N>>`, allowing for heap-based manipulation of fixed-size arrays.
    * `Deserialize` no longer requires `T: Default`
    * Make `IntoArrayLength`, `MappedSequence`, and `FunctionalSequence` safe traits.
    * Simplify `arr!` macro syntax.
        * `arr![1, 2, 3, 4]` or `arr![T; N]` forms, no explicit length for first variant.
        * No longer casts given expressions internally.
        * Type-deduction works similarly to `vec![]`, in that an empty array has an unknown type
    * Add the `internals` Cargo feature to expose dangerous things.
    * Added additional methods for working with chunks of arrays.
    * Added `From` impls for tuples with 1-12 (inclusive) items of the same type, matching the standard library.
    * Workaround potential Rust/LLVM regressions with `FunctionalSequence::zip()`/`::map()`
    * Added the `faster-hex` optional dependency for SIMD-accelerated hex encoding
    * Improve documentation

* **`0.14.6`**
    * Add an optional `Zeroize` impl for `GenericArray` ([#126](https://github.com/fizyk20/generic-array/pull/126) and [#112](https://github.com/fizyk20/generic-array/pull/112))
    * Cleanup some unsafe ([#125](https://github.com/fizyk20/generic-array/pull/125)) and typos ([#114](https://github.com/fizyk20/generic-array/pull/114))
    * Use `include` in `Cargo.toml` to reduce package size

* **`0.14.5`**
    * Fix unsoundness behavior in `GenericArrayIter::clone` ([#120](https://github.com/fizyk20/generic-array/pull/120))

* **`0.14.4`**
    * Update `typenum` to `1.12.0`
    * Make `Drop` a no-op when the inner type does not require `Drop` (using `core::mem::needs_drop`)

* **`0.14.3`**
    * Improve behavior of `GenericArray::from_exact_iter` to assume `ExactIterator`s can lie.
    * Fix alignment of zero-length `GenericArray`s
    * Implement `From<&[T; N]> for &GenericArray<T, N>` and its mutable variant

* **`0.14.2`**
    * Lower MSRV to `1.36.0` without `From<[T; N]>` implementations.

* **`0.14.1`**
    * Fix element conversions in `arr!` macro.

* **`0.14.0`**
    * Replace `Into` implementations with the more general `From`.
        * Requires minumum Rust version of 1.41.0
    * Fix unsoundness in `arr!` macro.
    * Fix meta variable misuse
    * Fix Undefined Behavior across the crate by switching to `MaybeUninit`
    * Improve some documentation and doctests
    * Add `AsRef<[T; N]>` and `AsMut<[T; N]>` impls to `GenericArray<T, N>`
    * Add `Split` impl for `&GenericArray` and `&mut GenericArray`

* **`0.13.2`**
    * Add feature `more_lengths`, which adds more `From`/`Into` implementations for arrays of various lengths.

* **`0.13.1`**
    * Mark `GenericArray` as `#[repr(transparent)]`
    * Implement `Into<[T; N]>` for `GenericArray<T, N>` up to N=32

* **`0.13.0`**
    * Allow `arr!` to be imported with use syntax.
        * Requires minumum Rust version of 1.30.1

* **`0.12.2`**
    * Implement `FusedIterator` for `GenericArrayIter`

* **`0.12.1`**
    * Use internal iteration where possible and provide more efficient internal iteration methods.

* **`0.12.0`**
    * Allow trailing commas in `arr!` macro.
    * **BREAKING**: Serialize `GenericArray` using `serde` tuples, instead of variable-length sequences. This may not be compatible with old serialized data.

* **`0.11.0`**
    * **BREAKING** Redesign `GenericSequence` with an emphasis on use in generic type parameters.
    * Add `MappedGenericSequence` and `FunctionalSequence`
        * Implements optimized `map`, `zip` and `fold` for `GenericArray`, `&GenericArray` and `&mut GenericArray`
    * **BREAKING** Remove `map_ref`, `zip_ref` and `map_slice`
        * `map_slice` is now equivalent to `GenericArray::from_iter(slice.iter().map(...))`
* **`0.10.0`**
    * Add `GenericSequence`, `Lengthen`, `Shorten`, `Split` and `Concat` traits.
    * Redefine `transmute` to avert errors.
* **`0.9.0`**
    * Rewrite construction methods to be well-defined in panic situations, correctly dropping elements.
    * `NoDrop` crate replaced by `ManuallyDrop` as it became stable in Rust core.
    * Add optimized `map`/`map_ref` and `zip`/`zip_ref` methods to `GenericArray`
* **`0.8.0`**
    * Implement `AsRef`, `AsMut`, `Borrow`, `BorrowMut`, `Hash` for `GenericArray`
    * Update `serde` to `1.0`
    * Update `typenum`
    * Make macro `arr!` non-cloning
    * Implement `From<[T; N]>` up to `N=32`
    * Fix #45
* **`0.7.0`**
    * Upgrade `serde` to `0.9`
    * Make `serde` with `no_std`
    * Implement `PartialOrd`/`Ord` for `GenericArray`
* **`0.6.0`**
    * Fixed #30
    * Implement `Default` for `GenericArray`
    * Implement `LowerHex` and `UpperHex` for `GenericArray<u8, N>`
    * Use `precision` formatting field in hex representation
    * Add `as_slice`, `as_mut_slice`
    * Remove `GenericArray::new` in favor of `Default` trait
    * Add `from_slice` and `from_mut_slice`
    * `no_std` and `core` for crate.
* **`0.5.0`**
    * Update `serde`
    * remove `no_std` feature, fixed #19
* **`0.4.0`**
    * Re-export `typenum`
* **`0.3.0`**
    * Implement `IntoIter` for `GenericArray`
    * Add `map` method
    * Add optional `serde` (de)serialization support feature.
* **`< 0.3.0`**
    * Initial implementation in late 2015
