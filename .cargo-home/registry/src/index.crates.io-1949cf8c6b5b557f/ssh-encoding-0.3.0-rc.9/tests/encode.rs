//! Tests for the `Encode` trait.

#![cfg(feature = "alloc")]

use hex_literal::hex;
use ssh_encoding::Encode;

#[test]
fn encode_u8() {
    let mut out = Vec::new();
    0x42u8.encode(&mut out).unwrap();
    assert_eq!(out, hex!("42"));
}

#[test]
fn encode_boolean() {
    let mut out = Vec::new();
    true.encode(&mut out).unwrap();
    assert_eq!(out, hex!("01"));
}

#[test]
fn encode_u32() {
    let mut out = Vec::new();
    0xDEADBEEFu32.encode(&mut out).unwrap();
    assert_eq!(out, hex!("DEADBEEF"));
}

#[test]
fn encode_u64() {
    let mut out = Vec::new();
    0xDEADBEEFCAFEu64.encode(&mut out).unwrap();
    assert_eq!(out, hex!("0000DEADBEEFCAFE"));
}

#[test]
fn encode_usize() {
    let mut out = Vec::new();
    0xDEADBEEFusize.encode(&mut out).unwrap();
    assert_eq!(out, hex!("DEADBEEF"));
}

#[test]
fn encode_byte_array() {
    let mut out = Vec::new();
    b"example".encode(&mut out).unwrap();
    assert_eq!(out, hex!("6578616d706c65"));
}

#[test]
fn encode_byte_slice() {
    let mut out = Vec::new();
    b"example".as_slice().encode(&mut out).unwrap();
    assert_eq!(out, hex!("000000076578616d706c65"));
}

#[test]
fn encode_byte_vec() {
    let mut out = Vec::new();
    Vec::from(&b"example"[..]).encode(&mut out).unwrap();
    assert_eq!(out, hex!("000000076578616d706c65"));
}

#[test]
fn encode_str() {
    let mut out = Vec::new();
    "example".encode(&mut out).unwrap();
    assert_eq!(out, hex!("000000076578616d706c65"));
}

#[test]
fn encode_string() {
    let mut out = Vec::new();
    String::from("example").encode(&mut out).unwrap();
    assert_eq!(out, hex!("000000076578616d706c65"));
}

#[test]
fn encode_string_vec() {
    let vec = ["foo", "bar", "baz"]
        .iter()
        .map(|&s| s.to_owned())
        .collect::<Vec<String>>();

    let mut out = Vec::new();
    vec.encode(&mut out).unwrap();

    assert_eq!(
        out,
        hex!("0000001500000003666f6f000000036261720000000362617a")
    );

    // Should also work with a Vec of references to Strings.
    let vec: Vec<&String> = vec.iter().collect();
    let mut out = Vec::new();
    vec.encode(&mut out).unwrap();

    assert_eq!(
        out,
        hex!("0000001500000003666f6f000000036261720000000362617a")
    );
}

#[test]
fn encode_str_vec() {
    let vec = vec!["foo", "bar", "baz"];

    let mut out = Vec::new();
    vec.encode(&mut out).unwrap();

    assert_eq!(
        out,
        hex!("0000001500000003666f6f000000036261720000000362617a")
    );
}

#[test]
fn encode_slice_vec() {
    let vec = vec![[1u8].as_slice(), [2u8, 3u8].as_slice(), [4u8].as_slice()];

    let mut out = Vec::new();
    vec.encode(&mut out).unwrap();

    assert_eq!(out, hex!("0000001000000001010000000202030000000104"));
}
