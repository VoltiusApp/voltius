use rust_decimal::prelude::*;

use super::Bit;
use crate::{ParseError, ValueParseError, common::get_char_from_bytes, unit::parse::read_xib};

/// Associated functions for parsing strings.
impl Bit {
    /// Create a new `Bit` instance from a string.
    /// The string may be `"10"`, `"10B"`, `"10M"`, `"10MB"`, `"10MiB"`, `"80b"`, `"80Mb"`, `"80Mbit"`.
    ///
    /// You can ignore the case of **"B"** (bit), which means **b** will still be treated as bits instead of bits.
    ///
    /// # Examples
    ///
    /// ```
    /// # use byte_unit::Bit;
    /// let bit = Bit::parse_str("123Kib").unwrap(); // 123 * 1024 bits
    /// ```
    pub fn parse_str<S: AsRef<str>>(s: S) -> Result<Self, ParseError> {
        let s = s.as_ref().trim();

        let mut bits = s.bytes();

        let mut value = match bits.next() {
            Some(e) => match e {
                b'0'..=b'9' => Decimal::from(e - b'0'),
                _ => {
                    return Err(ValueParseError::NotNumber(unsafe {
                        get_char_from_bytes(e, bits)
                    })
                    .into());
                },
            },
            None => return Err(ValueParseError::NoValue.into()),
        };

        let e = 'outer: loop {
            match bits.next() {
                Some(e) => match e {
                    b'0'..=b'9' => {
                        value = value
                            .checked_mul(Decimal::TEN)
                            .ok_or(ValueParseError::NumberTooLong)?
                            .checked_add(Decimal::from(e - b'0'))
                            .ok_or(ValueParseError::NumberTooLong)?;
                    },
                    b'.' => {
                        let mut i = 1u32;

                        loop {
                            match bits.next() {
                                Some(e) => match e {
                                    b'0'..=b'9' => {
                                        value += {
                                            let mut d = Decimal::from(e - b'0');

                                            d.set_scale(i)
                                                .map_err(|_| ValueParseError::NumberTooLong)?;

                                            d
                                        };

                                        i += 1;
                                    },
                                    _ => {
                                        if i == 1 {
                                            return Err(ValueParseError::NotNumber(unsafe {
                                                get_char_from_bytes(e, bits)
                                            })
                                            .into());
                                        }

                                        match e {
                                            b' ' => loop {
                                                match bits.next() {
                                                    Some(e) => match e {
                                                        b' ' => (),
                                                        _ => break 'outer Some(e),
                                                    },
                                                    None => break 'outer None,
                                                }
                                            },
                                            _ => break 'outer Some(e),
                                        }
                                    },
                                },
                                None => {
                                    if i == 1 {
                                        return Err(ValueParseError::NotNumber(unsafe {
                                            get_char_from_bytes(e, bits)
                                        })
                                        .into());
                                    }

                                    break 'outer None;
                                },
                            }
                        }
                    },
                    b' ' => loop {
                        match bits.next() {
                            Some(e) => match e {
                                b' ' => (),
                                _ => break 'outer Some(e),
                            },
                            None => break 'outer None,
                        }
                    },
                    _ => break 'outer Some(e),
                },
                None => break None,
            }
        };

        let unit = read_xib(e, bits, false, false)?;

        Self::from_decimal_with_unit(value, unit)
            .ok_or_else(|| ValueParseError::ExceededBounds(value).into())
    }
}
