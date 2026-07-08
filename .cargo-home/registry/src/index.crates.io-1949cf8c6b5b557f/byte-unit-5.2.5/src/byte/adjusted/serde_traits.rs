use alloc::format;
use core::{
    fmt::{self, Formatter},
    str::FromStr,
};

use serde::{
    self, Deserialize, Deserializer, Serialize, Serializer,
    de::{Error as DeError, Visitor},
};

use super::AdjustedByte;

impl Serialize for AdjustedByte {
    #[inline]
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer, {
        if serializer.is_human_readable() {
            serializer.serialize_str(format!("{:#}", self).as_str())
        } else {
            serializer.serialize_str(format!("{:-#}", self).as_str())
        }
    }
}

impl<'de> Deserialize<'de> for AdjustedByte {
    #[inline]
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>, {
        struct MyVisitor;

        impl<'de> Visitor<'de> for MyVisitor {
            type Value = AdjustedByte;

            #[inline]
            fn expecting(&self, f: &mut Formatter<'_>) -> fmt::Result {
                f.write_str("a string such as \"123\", \"123KiB\", \"50.84 MB\"")
            }

            #[inline]
            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: DeError, {
                AdjustedByte::from_str(v).map_err(DeError::custom)
            }
        }

        deserializer.deserialize_str(MyVisitor)
    }
}
