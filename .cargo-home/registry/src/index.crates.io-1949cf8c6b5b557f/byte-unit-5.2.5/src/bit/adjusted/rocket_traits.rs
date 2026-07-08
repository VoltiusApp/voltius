use core::str::FromStr;

use rocket::{
    form::{self, FromFormField, ValueField},
    request::FromParam,
};

use super::AdjustedBit;
use crate::ParseError;

impl<'r> FromParam<'r> for AdjustedBit {
    type Error = ParseError;

    #[inline]
    fn from_param(v: &'r str) -> Result<Self, Self::Error> {
        Self::from_str(v)
    }
}

impl<'r> FromFormField<'r> for AdjustedBit {
    #[inline]
    fn from_value(v: ValueField<'r>) -> form::Result<'r, Self> {
        Ok(Self::from_str(v.value).map_err(form::Error::custom)?)
    }
}
