# integer-encoding-rs

[![crates.io](https://img.shields.io/crates/v/integer-encoding.svg)](https://crates.io/crates/integer-encoding)
[![Actions CI](https://github.com/dermesser/integer-encoding-rs/workflows/Actions%20CI/badge.svg)](https://github.com/dermesser/integer-encoding-rs/actions)

[full documentation](https://docs.rs/integer-encoding/)

This crate provides encoding and decoding of integers to and from bytestring
representations.

The format is described here: [Google's protobuf integer encoding technique](https://developers.google.com/protocol-buffers/docs/encoding).

Please feel free to use `cargo bench` to determine the rate at which your
machine can encode and decode varints and fixedints. Note that one iteration
comprises each eight rounds of encoding (or decoding) a signed and an unsigned
integer each -- divide the resulting benchmark time by 16 in order to have a
rough estimate of time per operation. The integers are very large, so the
results represent the worst case.

## Crate

If you use Tokio v0.2 and you use the asynchronous types in this crate (feature
`tokio_async`), you may be interested in the `v2.0` branch. It is still
maintained with the occasional fix for edge cases and depends on Tokio v0.2.

## FixedInt

`FixedInt` casts integers to bytes by either copying the underlying memory or
performing a transmutation. The encoded values use are little-endian.

## VarInt

`VarInt` encodes integers in blocks of 7 bits; the MSB is set for every byte but
the last, in which it is cleared.

Signed values are first converted to an unsigned representation using zigzag
encoding (also described on the page linked above), and then encoded as every
other unsigned number.

