//! Tests for the derive implementations for the `Decode` and `Encode` traits.

#![cfg(all(feature = "derive", feature = "alloc"))]
#![allow(missing_docs, missing_copy_implementations)]

use ssh_encoding::{Decode, Encode, Error};

#[derive(Debug, PartialEq, Decode, Encode)]
pub struct MostTypes<T>
where
    T: Encode + Decode<Error = Error>,
{
    a: u8,
    b: u32,
    c: u64,
    d: usize,
    e: bool,
    f: [u8; 7],
    g: String,
    h: Vec<u8>,
    i: T,
}

// Only `Encode` is derived for references, as `Decode` isn't implemented for them.
#[derive(Debug, PartialEq, Encode)]
pub struct Reference<'a>(&'a [u8]);

#[derive(Debug, PartialEq, Decode, Encode)]
#[ssh(length_prefixed)]
pub struct LengthPrefixed {
    #[ssh(length_prefixed)]
    a: u32,
    b: String,
}

#[derive(Debug, PartialEq, Encode, Decode)]
#[repr(u8)]
#[ssh(length_prefixed)]
pub enum ComplexEnum {
    Bar = 1,
    Baz {
        a: u32,
        #[ssh(length_prefixed)]
        b: u8,
    } = 2,
    Fiz(u32, #[ssh(length_prefixed)] u8) = 3,
}

#[derive(Debug, PartialEq, Encode, Decode)]
#[repr(u32)]
pub enum SimpleEnum {
    A = 1,
    B = 2,
}

#[derive(Debug, PartialEq, Encode, Decode)]
#[repr(u8)]
pub enum ModerateEnum {
    A = 1,
    B { a: String } = 2,
}

#[derive(Debug, PartialEq, Encode, Decode)]
pub struct Empty;

#[test]
fn derive_encode_decode_roundtrip_most_types() {
    #[rustfmt::skip]
    let data = [
        42,
        0xDE, 0xAD, 0xBE, 0xEF,
        0xCA, 0xFE, 0xBA, 0xBE, 0xFA, 0xCE, 0xFE, 0xED,
        0x00, 0x00, 0xAB, 0xCD,
        0x01,
        b'e', b'x', b'a', b'm', b'p', b'l', b'e',
        0x00, 0x00, 0x00, 0x05, b'h', b'e', b'l', b'l', b'o',
        0x00, 0x00, 0x00, 0x05, b'w', b'o', b'r', b'l', b'd',
        0x20,
    ];
    let expected = MostTypes {
        a: 42,
        b: 0xDEAD_BEEF,
        c: 0xCAFE_BABE_FACE_FEED,
        d: 0xABCD,
        e: true,
        f: *b"example",
        g: "hello".to_string(),
        h: b"world".to_vec(),
        i: 0x20u8,
    };
    assert_eq!(&data, expected.encode_vec().unwrap().as_slice());
    let most_types = MostTypes::<u8>::decode(&mut &data[..]).unwrap();
    assert_eq!(most_types, expected);
}

#[test]
fn derive_encode_reference() {
    let data = b"\x00\x00\x00\x07example";
    let expected = Reference(&data[4..]);
    assert_eq!(data, expected.encode_vec().unwrap().as_slice());
}

#[test]
fn derive_encode_decode_roundtrip_length_prefixed() {
    #[rustfmt::skip]
    let data = [
        0x00, 0x00, 0x00, 0x11,
        0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x2A,
        0x00, 0x00, 0x00, 0x05, b'h', b'e', b'l', b'l', b'o',
    ];
    let expected = LengthPrefixed {
        a: 42,
        b: "hello".to_string(),
    };
    assert_eq!(&data, expected.encode_vec().unwrap().as_slice());
    let length_prefixed = LengthPrefixed::decode(&mut &data[..]).unwrap();
    assert_eq!(length_prefixed, expected);
}

#[test]
fn derive_encode_decode_empty() {
    let data = [0u8; 0];
    let expected = Empty;
    assert_eq!(data, expected.encode_vec().unwrap().as_slice());
    let actual = Empty::decode(&mut &data[..]).unwrap();
    assert_eq!(actual, expected);
}

#[test]
fn derive_encode_decode_enum_unit() {
    #[rustfmt::skip]
    let data = [
        0, 0, 0, 1,  // Length prefix of entire enum.
        1,           // Discriminant for Foo::Bar.
    ];
    let expected = ComplexEnum::Bar;
    assert_eq!(data, expected.encode_vec().unwrap().as_slice());
    let actual = ComplexEnum::decode(&mut &data[..]).unwrap();
    assert_eq!(actual, expected);
}

#[test]
fn derive_encode_decode_enum_struct() {
    #[rustfmt::skip]
    let data = [
        0, 0, 0, 10,  // Length prefix of entire enum.
        2,            // Discriminant for Foo::Baz.
        0, 0, 0, 1,   // Value of Foo::Baz::a.
        0, 0, 0, 1,   // Length prefix of Foo::Baz::b.
        2             // Value of Foo::Baz::b.
    ];
    let expected = ComplexEnum::Baz { a: 1, b: 2 };
    assert_eq!(data, expected.encode_vec().unwrap().as_slice());
    let actual = ComplexEnum::decode(&mut &data[..]).unwrap();
    assert_eq!(actual, expected);
}

#[test]
fn derive_encode_decode_enum_tuple() {
    #[rustfmt::skip]
    let data = [
        0, 0, 0, 10,  // Length prefix of entire enum.
        3,           // Discriminant for Foo::Fiz.
        0, 0, 0, 1,  // Value of Foo::Fiz::0.
        0, 0, 0, 1,  // Length prefix of Foo::Fiz::1.
        2            // Value of Foo::Fiz::1.
    ];
    let expected = ComplexEnum::Fiz(1, 2);
    assert_eq!(data, expected.encode_vec().unwrap().as_slice());
    let actual = ComplexEnum::decode(&mut &data[..]).unwrap();
    assert_eq!(actual, expected);
}

#[test]
fn derive_encode_decode_enum_no_prefix_u32_repr() {
    #[rustfmt::skip]
    let data = [
        0, 0, 0, 1,  // Discriminant for Bar::A.
    ];
    let expected = SimpleEnum::A;
    assert_eq!(data, expected.encode_vec().unwrap().as_slice());
    let actual = SimpleEnum::decode(&mut &data[..]).unwrap();
    assert_eq!(actual, expected);
}
