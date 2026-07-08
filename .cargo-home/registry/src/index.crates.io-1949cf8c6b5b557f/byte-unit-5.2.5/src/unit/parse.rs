use core::str::Bytes;

use super::Unit;
use crate::{UnitParseError, common::get_char_from_bytes};

/// Associated functions for parsing strings.
impl Unit {
    /// Create a new `Unit` instance from a string.
    /// The string may be `""`, `"B"`, `"M"`, `"MB"`, `"MiB"`, `"b"`, `"Mb"`, `"Mbit"`.
    ///
    /// You can ignore the case of **"B"** (byte), which means **b** will still be treated as bytes instead of bits.
    ///
    /// If the input string is empty, it will return `B` if `prefer_byte` is true; otherwise, it will return `b`. Similarly, if the string is not empty but it does not explicitly contains `"B"`, `"b"`, or `"bit"`, it will imply the base is `"B"` if `prefer_byte` is true; otherwise, imply the base is `"b"`.
    ///
    /// # Examples
    ///
    /// ```
    /// # use byte_unit::Unit;
    /// let unit = Unit::parse_str("Kib", true, true).unwrap(); // KiB
    /// ```
    ///
    /// ```
    /// # use byte_unit::Unit;
    /// let unit = Unit::parse_str("Kib", false, true).unwrap(); // Kibit
    /// ```
    pub fn parse_str<S: AsRef<str>>(
        s: S,
        ignore_case: bool,
        prefer_byte: bool,
    ) -> Result<Self, UnitParseError> {
        let s = s.as_ref().trim();

        let mut bytes = s.bytes();

        read_xib(bytes.next(), bytes, ignore_case, prefer_byte)
    }
}

pub(crate) fn read_xib(
    e: Option<u8>,
    bytes: Bytes,
    ignore_case: bool,
    prefer_byte: bool,
) -> Result<Unit, UnitParseError> {
    match e {
        Some(e) => match e.to_ascii_uppercase() {
            b'B' => {
                let byte = read_b(bytes, if ignore_case { true } else { e == b'B' })?;

                if byte { Ok(Unit::B) } else { Ok(Unit::Bit) }
            },
            b'K' => {
                let (i, byte) = read_ib(bytes, ignore_case, prefer_byte)?;

                if i {
                    if byte { Ok(Unit::KiB) } else { Ok(Unit::Kibit) }
                } else if byte {
                    Ok(Unit::KB)
                } else {
                    Ok(Unit::Kbit)
                }
            },
            b'M' => {
                let (i, byte) = read_ib(bytes, ignore_case, prefer_byte)?;

                if i {
                    if byte { Ok(Unit::MiB) } else { Ok(Unit::Mibit) }
                } else if byte {
                    Ok(Unit::MB)
                } else {
                    Ok(Unit::Mbit)
                }
            },
            b'G' => {
                let (i, byte) = read_ib(bytes, ignore_case, prefer_byte)?;

                if i {
                    if byte { Ok(Unit::GiB) } else { Ok(Unit::Gibit) }
                } else if byte {
                    Ok(Unit::GB)
                } else {
                    Ok(Unit::Gbit)
                }
            },
            b'T' => {
                let (i, byte) = read_ib(bytes, ignore_case, prefer_byte)?;

                if i {
                    if byte { Ok(Unit::TiB) } else { Ok(Unit::Tibit) }
                } else if byte {
                    Ok(Unit::TB)
                } else {
                    Ok(Unit::Tbit)
                }
            },
            b'P' => {
                let (i, byte) = read_ib(bytes, ignore_case, prefer_byte)?;

                if i {
                    if byte { Ok(Unit::PiB) } else { Ok(Unit::Pibit) }
                } else if byte {
                    Ok(Unit::PB)
                } else {
                    Ok(Unit::Pbit)
                }
            },
            b'E' => {
                let (i, byte) = read_ib(bytes, ignore_case, prefer_byte)?;

                if i {
                    if byte { Ok(Unit::EiB) } else { Ok(Unit::Eibit) }
                } else if byte {
                    Ok(Unit::EB)
                } else {
                    Ok(Unit::Ebit)
                }
            },
            #[cfg(feature = "u128")]
            b'Z' => {
                let (i, byte) = read_ib(bytes, ignore_case, prefer_byte)?;

                if i {
                    if byte { Ok(Unit::ZiB) } else { Ok(Unit::Zibit) }
                } else if byte {
                    Ok(Unit::ZB)
                } else {
                    Ok(Unit::Zbit)
                }
            },
            #[cfg(feature = "u128")]
            b'Y' => {
                let (i, byte) = read_ib(bytes, ignore_case, prefer_byte)?;

                if i {
                    if byte { Ok(Unit::YiB) } else { Ok(Unit::Yibit) }
                } else if byte {
                    Ok(Unit::YB)
                } else {
                    Ok(Unit::Ybit)
                }
            },
            _ => {
                #[cfg(feature = "u128")]
                {
                    Err(UnitParseError {
                        character:                unsafe { get_char_from_bytes(e, bytes) },
                        expected_characters:      &['B', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'],
                        also_expect_no_character: true,
                    })
                }
                #[cfg(not(feature = "u128"))]
                {
                    Err(UnitParseError {
                        character:                unsafe { get_char_from_bytes(e, bytes) },
                        expected_characters:      &['B', 'K', 'M', 'G', 'T', 'P', 'E'],
                        also_expect_no_character: true,
                    })
                }
            },
        },
        None => Ok(if prefer_byte { Unit::B } else { Unit::Bit }),
    }
}
fn read_ib(
    mut bytes: Bytes,
    ignore_case: bool,
    default_upper_case: bool,
) -> Result<(bool, bool), UnitParseError> {
    match bytes.next() {
        Some(mut e) => {
            let i = e == b'i' || e == b'I';

            if i {
                match bytes.next() {
                    Some(ne) => e = ne,
                    None => return Ok((true, default_upper_case)),
                }
            }

            match e {
                b'b' | b'B' => Ok((i, read_b(bytes, if ignore_case { true } else { e == b'B' })?)),
                _ => {
                    let expected_characters: &[char] = if ignore_case {
                        if default_upper_case { &['B'] } else { &['b'] }
                    } else {
                        &['B', 'b']
                    };

                    Err(UnitParseError {
                        character: unsafe { get_char_from_bytes(e, bytes) },
                        expected_characters,
                        also_expect_no_character: true,
                    })
                },
            }
        },
        None => Ok((false, default_upper_case)),
    }
}

fn read_b(mut bytes: Bytes, byte: bool) -> Result<bool, UnitParseError> {
    match bytes.next() {
        Some(e) => match e.to_ascii_lowercase() {
            b'i' => match bytes.next() {
                Some(e) => match e.to_ascii_lowercase() {
                    b't' => match bytes.next() {
                        Some(e) => match e.to_ascii_lowercase() {
                            b's' => match bytes.next() {
                                Some(e) => Err(UnitParseError {
                                    character:                unsafe {
                                        get_char_from_bytes(e, bytes)
                                    },
                                    expected_characters:      &[],
                                    also_expect_no_character: true,
                                }),
                                None => Ok(false),
                            },
                            _ => Err(UnitParseError {
                                character:                unsafe { get_char_from_bytes(e, bytes) },
                                expected_characters:      &['s'],
                                also_expect_no_character: true,
                            }),
                        },
                        None => Ok(false),
                    },
                    _ => Err(UnitParseError {
                        character:                unsafe { get_char_from_bytes(e, bytes) },
                        expected_characters:      &['t'],
                        also_expect_no_character: false,
                    }),
                },
                None => Err(UnitParseError {
                    character:                'i',
                    expected_characters:      &[],
                    also_expect_no_character: true,
                }),
            },
            _ => Err(UnitParseError {
                character:                unsafe { get_char_from_bytes(e, bytes) },
                expected_characters:      &['i'],
                also_expect_no_character: true,
            }),
        },
        None => Ok(byte),
    }
}
