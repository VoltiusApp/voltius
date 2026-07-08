use alloc::format;
use core::{
    fmt::{self, Formatter},
    str::FromStr,
};

use serde::{
    self, Deserialize, Deserializer, Serialize, Serializer,
    de::{Error as DeError, Unexpected, Visitor},
};

use super::Bit;
#[cfg(feature = "u128")]
use super::RONNABIT;

impl Serialize for Bit {
    #[inline]
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer, {
        if serializer.is_human_readable() {
            serializer.serialize_str(format!("{self:#}").as_str())
        } else {
            serializer.serialize_u128(self.as_u128())
        }
    }
}

impl<'de> Deserialize<'de> for Bit {
    #[inline]
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>, {
        struct MyVisitor;

        impl<'de> Visitor<'de> for MyVisitor {
            type Value = Bit;

            #[inline]
            fn expecting(&self, f: &mut Formatter<'_>) -> fmt::Result {
                f.write_str("a string such as \"123\", \"123Kib\", \"50.84 Mb\", or ")?;

                #[cfg(feature = "u128")]
                {
                    f.write_fmt(format_args!("a positive integer smaller than {RONNABIT}"))
                }

                #[cfg(not(feature = "u128"))]
                {
                    f.write_fmt(format_args!(
                        "a positive integer smaller than {}",
                        u64::MAX as u128 + 1
                    ))
                }
            }

            #[inline]
            fn visit_u128<E>(self, v: u128) -> Result<Self::Value, E>
            where
                E: DeError, {
                Bit::from_u128(v).ok_or_else(|| {
                    DeError::invalid_value(Unexpected::Other(format!("{v}").as_str()), &self)
                })
            }

            #[inline]
            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: DeError, {
                Bit::from_str(v).map_err(DeError::custom)
            }
        }

        if deserializer.is_human_readable() {
            deserializer.deserialize_str(MyVisitor)
        } else {
            deserializer.deserialize_u128(MyVisitor)
        }
    }
}
