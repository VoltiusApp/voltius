use core::{fmt, fmt::Formatter, str::FromStr};

use serde::{
    self, Deserialize, Deserializer, Serialize, Serializer,
    de::{Error as DeError, Visitor},
};

use super::Unit;

impl Serialize for Unit {
    #[inline]
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer, {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for Unit {
    #[inline]
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>, {
        struct MyVisitor;

        impl<'de> Visitor<'de> for MyVisitor {
            type Value = Unit;

            #[inline]
            fn expecting(&self, f: &mut Formatter<'_>) -> fmt::Result {
                f.write_str("a string such as \"B\", \"KB\" or \"MiB\"")
            }

            #[inline]
            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: DeError, {
                Unit::from_str(v).map_err(DeError::custom)
            }
        }

        deserializer.deserialize_str(MyVisitor)
    }
}
