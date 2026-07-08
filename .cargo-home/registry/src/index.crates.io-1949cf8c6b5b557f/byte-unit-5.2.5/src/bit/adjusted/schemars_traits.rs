use alloc::{borrow::Cow, string::String};

use schemars::{JsonSchema, Schema, SchemaGenerator};

use super::AdjustedBit;

impl JsonSchema for AdjustedBit {
    #[inline]
    fn inline_schema() -> bool {
        true
    }

    #[inline]
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("AdjustedBit")
    }

    #[inline]
    fn json_schema(generator: &mut SchemaGenerator) -> Schema {
        generator.subschema_for::<String>()
    }
}
