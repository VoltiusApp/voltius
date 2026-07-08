//! ASN.1 `GeneralizedTime` support.
#![cfg_attr(feature = "arbitrary", allow(clippy::arithmetic_side_effects))]

use crate::{
    DecodeValue, EncodeValue, Error, ErrorKind, FixedTag, Header, Length, Reader, Result, Tag,
    Writer,
    datetime::{self, DateTime},
    ord::OrdIsValueOrd,
};
use core::time::Duration;

#[cfg(feature = "std")]
use {crate::asn1::AnyRef, std::time::SystemTime};

#[cfg(feature = "time")]
use time::PrimitiveDateTime;

/// ASN.1 `GeneralizedTime` type.
///
/// This type implements the validity requirements specified in
/// [RFC 5280 Section 4.1.2.5.2][1], namely:
///
/// > For the purposes of this profile, GeneralizedTime values MUST be
/// > expressed in Greenwich Mean Time (Zulu) and MUST include seconds
/// > (i.e., times are `YYYYMMDDHHMMSSZ`), even where the number of seconds
/// > is zero.  GeneralizedTime values MUST NOT include fractional seconds.
///
/// [1]: https://tools.ietf.org/html/rfc5280#section-4.1.2.5.2
#[cfg_attr(feature = "arbitrary", derive(arbitrary::Arbitrary))]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub struct GeneralizedTime(DateTime);

impl GeneralizedTime {
    /// Length of an RFC 5280-flavored ASN.1 DER-encoded [`GeneralizedTime`].
    const LENGTH: usize = 15;

    /// Create a [`GeneralizedTime`] from a [`DateTime`].
    #[must_use]
    pub const fn from_date_time(datetime: DateTime) -> Self {
        Self(datetime)
    }

    /// Convert this [`GeneralizedTime`] into a [`DateTime`].
    #[must_use]
    pub const fn to_date_time(&self) -> DateTime {
        self.0
    }

    /// Create a new [`GeneralizedTime`] given a [`Duration`] since `UNIX_EPOCH`
    /// (a.k.a. "Unix time").
    ///
    /// # Errors
    /// Returns [`Error`] with a value error kind in the event `unix_duration` could not be parsed.
    pub fn from_unix_duration(unix_duration: Duration) -> Result<Self> {
        DateTime::from_unix_duration(unix_duration)
            .map(Into::into)
            .map_err(|_| Self::TAG.value_error().into())
    }

    /// Get the duration of this timestamp since `UNIX_EPOCH`.
    #[must_use]
    pub fn to_unix_duration(&self) -> Duration {
        self.0.unix_duration()
    }

    /// Instantiate from [`SystemTime`].
    ///
    /// # Errors
    /// If the time conversion failed.
    #[cfg(feature = "std")]
    pub fn from_system_time(time: SystemTime) -> Result<Self> {
        DateTime::try_from(time)
            .map(Into::into)
            .map_err(|_| Self::TAG.value_error().into())
    }

    /// Convert to [`SystemTime`].
    #[cfg(feature = "std")]
    #[must_use]
    pub fn to_system_time(&self) -> SystemTime {
        self.0.to_system_time()
    }
}

impl_any_conversions!(GeneralizedTime);

/// Creates a [`GeneralizedTime`] from its individual, ascii
/// encoded components.
fn decode_from_values(
    year: (u8, u8, u8, u8),
    month: (u8, u8),
    day: (u8, u8),
    hour: (u8, u8),
    min: (u8, u8),
    sec: (u8, u8),
) -> Result<GeneralizedTime> {
    let year = u16::from(datetime::decode_decimal(
        GeneralizedTime::TAG,
        year.0,
        year.1,
    )?)
    .checked_mul(100)
    .and_then(|y| {
        y.checked_add(
            datetime::decode_decimal(GeneralizedTime::TAG, year.2, year.3)
                .ok()?
                .into(),
        )
    })
    .ok_or(ErrorKind::DateTime)?;
    let month = datetime::decode_decimal(GeneralizedTime::TAG, month.0, month.1)?;
    let day = datetime::decode_decimal(GeneralizedTime::TAG, day.0, day.1)?;
    let hour = datetime::decode_decimal(GeneralizedTime::TAG, hour.0, hour.1)?;
    let minute = datetime::decode_decimal(GeneralizedTime::TAG, min.0, min.1)?;
    let second = datetime::decode_decimal(GeneralizedTime::TAG, sec.0, sec.1)?;

    let dt = DateTime::new(year, month, day, hour, minute, second)
        .map_err(|_| GeneralizedTime::TAG.value_error())?;

    GeneralizedTime::from_unix_duration(dt.unix_duration())
}

impl<'a> DecodeValue<'a> for GeneralizedTime {
    type Error = Error;

    fn decode_value<R: Reader<'a>>(reader: &mut R, header: Header) -> Result<Self> {
        if Self::LENGTH != usize::try_from(header.length())? {
            return Err(reader.error(Self::TAG.value_error()));
        }

        let mut bytes = [0u8; Self::LENGTH];
        reader.read_into(&mut bytes)?;

        match bytes {
            // RFC 5280 requires mandatory seconds and Z-normalized time zone
            [
                y1,
                y2,
                y3,
                y4,
                mon1,
                mon2,
                day1,
                day2,
                hour1,
                hour2,
                min1,
                min2,
                sec1,
                sec2,
                b'Z',
            ] => decode_from_values(
                (y1, y2, y3, y4),
                (mon1, mon2),
                (day1, day2),
                (hour1, hour2),
                (min1, min2),
                (sec1, sec2),
            )
            .map_err(|err| reader.error(err.kind())),
            _ => Err(reader.error(Self::TAG.value_error())),
        }
    }
}

impl EncodeValue for GeneralizedTime {
    fn value_len(&self) -> Result<Length> {
        Self::LENGTH.try_into()
    }

    fn encode_value(&self, writer: &mut impl Writer) -> Result<()> {
        let year_hi = u8::try_from(self.0.year() / 100)?;
        let year_lo = u8::try_from(self.0.year() % 100)?;

        datetime::encode_decimal(writer, Self::TAG, year_hi)?;
        datetime::encode_decimal(writer, Self::TAG, year_lo)?;
        datetime::encode_decimal(writer, Self::TAG, self.0.month())?;
        datetime::encode_decimal(writer, Self::TAG, self.0.day())?;
        datetime::encode_decimal(writer, Self::TAG, self.0.hour())?;
        datetime::encode_decimal(writer, Self::TAG, self.0.minutes())?;
        datetime::encode_decimal(writer, Self::TAG, self.0.seconds())?;
        writer.write_byte(b'Z')
    }
}

impl FixedTag for GeneralizedTime {
    const TAG: Tag = Tag::GeneralizedTime;
}

impl OrdIsValueOrd for GeneralizedTime {}

impl From<&GeneralizedTime> for GeneralizedTime {
    fn from(value: &GeneralizedTime) -> GeneralizedTime {
        *value
    }
}

impl From<GeneralizedTime> for DateTime {
    fn from(utc_time: GeneralizedTime) -> DateTime {
        utc_time.0
    }
}

impl From<&GeneralizedTime> for DateTime {
    fn from(utc_time: &GeneralizedTime) -> DateTime {
        utc_time.0
    }
}

impl From<DateTime> for GeneralizedTime {
    fn from(datetime: DateTime) -> Self {
        Self::from_date_time(datetime)
    }
}

impl From<&DateTime> for GeneralizedTime {
    fn from(datetime: &DateTime) -> Self {
        Self::from_date_time(*datetime)
    }
}

impl<'a> DecodeValue<'a> for DateTime {
    type Error = Error;

    fn decode_value<R: Reader<'a>>(reader: &mut R, header: Header) -> Result<Self> {
        Ok(GeneralizedTime::decode_value(reader, header)?.into())
    }
}

impl EncodeValue for DateTime {
    fn value_len(&self) -> Result<Length> {
        GeneralizedTime::from(self).value_len()
    }

    fn encode_value(&self, writer: &mut impl Writer) -> Result<()> {
        GeneralizedTime::from(self).encode_value(writer)
    }
}

impl FixedTag for DateTime {
    const TAG: Tag = Tag::GeneralizedTime;
}

impl OrdIsValueOrd for DateTime {}

#[cfg(feature = "std")]
impl<'a> DecodeValue<'a> for SystemTime {
    type Error = Error;

    fn decode_value<R: Reader<'a>>(reader: &mut R, header: Header) -> Result<Self> {
        Ok(GeneralizedTime::decode_value(reader, header)?.into())
    }
}

#[cfg(feature = "std")]
impl EncodeValue for SystemTime {
    fn value_len(&self) -> Result<Length> {
        GeneralizedTime::try_from(self)?.value_len()
    }

    fn encode_value(&self, writer: &mut impl Writer) -> Result<()> {
        GeneralizedTime::try_from(self)?.encode_value(writer)
    }
}

#[cfg(feature = "std")]
impl From<GeneralizedTime> for SystemTime {
    fn from(time: GeneralizedTime) -> SystemTime {
        time.to_system_time()
    }
}

#[cfg(feature = "std")]
impl From<&GeneralizedTime> for SystemTime {
    fn from(time: &GeneralizedTime) -> SystemTime {
        time.to_system_time()
    }
}

#[cfg(feature = "std")]
impl TryFrom<SystemTime> for GeneralizedTime {
    type Error = Error;

    fn try_from(time: SystemTime) -> Result<GeneralizedTime> {
        GeneralizedTime::from_system_time(time)
    }
}

#[cfg(feature = "std")]
impl TryFrom<&SystemTime> for GeneralizedTime {
    type Error = Error;

    fn try_from(time: &SystemTime) -> Result<GeneralizedTime> {
        GeneralizedTime::from_system_time(*time)
    }
}

#[cfg(feature = "std")]
impl<'a> TryFrom<AnyRef<'a>> for SystemTime {
    type Error = Error;

    fn try_from(any: AnyRef<'a>) -> Result<SystemTime> {
        GeneralizedTime::try_from(any).map(|s| s.to_system_time())
    }
}

#[cfg(feature = "std")]
impl FixedTag for SystemTime {
    const TAG: Tag = Tag::GeneralizedTime;
}

#[cfg(feature = "std")]
impl OrdIsValueOrd for SystemTime {}

#[cfg(feature = "time")]
impl<'a> DecodeValue<'a> for PrimitiveDateTime {
    type Error = Error;

    fn decode_value<R: Reader<'a>>(reader: &mut R, header: Header) -> Result<Self> {
        GeneralizedTime::decode_value(reader, header)?.try_into()
    }
}

#[cfg(feature = "time")]
impl EncodeValue for PrimitiveDateTime {
    fn value_len(&self) -> Result<Length> {
        GeneralizedTime::try_from(self)?.value_len()
    }

    fn encode_value(&self, writer: &mut impl Writer) -> Result<()> {
        GeneralizedTime::try_from(self)?.encode_value(writer)
    }
}

#[cfg(feature = "time")]
impl FixedTag for PrimitiveDateTime {
    const TAG: Tag = Tag::GeneralizedTime;
}

#[cfg(feature = "time")]
impl OrdIsValueOrd for PrimitiveDateTime {}

#[cfg(feature = "time")]
impl TryFrom<PrimitiveDateTime> for GeneralizedTime {
    type Error = Error;

    fn try_from(time: PrimitiveDateTime) -> Result<GeneralizedTime> {
        Ok(GeneralizedTime::from_date_time(DateTime::try_from(time)?))
    }
}

#[cfg(feature = "time")]
impl TryFrom<&PrimitiveDateTime> for GeneralizedTime {
    type Error = Error;

    fn try_from(time: &PrimitiveDateTime) -> Result<GeneralizedTime> {
        Self::try_from(*time)
    }
}

#[cfg(feature = "time")]
impl TryFrom<GeneralizedTime> for PrimitiveDateTime {
    type Error = Error;

    fn try_from(time: GeneralizedTime) -> Result<PrimitiveDateTime> {
        time.to_date_time().try_into()
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::GeneralizedTime;
    use crate::{Decode, Encode, SliceWriter};
    use hex_literal::hex;

    #[test]
    fn round_trip() {
        let example_bytes = hex!("18 0f 31 39 39 31 30 35 30 36 32 33 34 35 34 30 5a");
        let utc_time = GeneralizedTime::from_der(&example_bytes).unwrap();
        assert_eq!(utc_time.to_unix_duration().as_secs(), 673573540);

        let mut buf = [0u8; 128];
        let mut writer = SliceWriter::new(&mut buf);
        utc_time.encode(&mut writer).unwrap();
        assert_eq!(example_bytes, writer.finish().unwrap());
    }

    #[test]
    fn max_valid_generalized_time() {
        let example_bytes = "\x18\x0f99991231235959Z".as_bytes();
        let utc_time = GeneralizedTime::from_der(example_bytes).unwrap();
        assert_eq!(utc_time.to_unix_duration().as_secs(), 253402300799);

        let mut buf = [0u8; 128];
        let mut writer = SliceWriter::new(&mut buf);
        utc_time.encode(&mut writer).unwrap();
        assert_eq!(example_bytes, writer.finish().unwrap());
    }

    #[test]
    fn invalid_year_generalized_time() {
        let example_bytes = "\x18\x0f999@1231235959Z".as_bytes();
        assert!(GeneralizedTime::from_der(example_bytes).is_err());
    }

    #[test]
    fn invalid_month_generalized_time() {
        let example_bytes = "\x18\x0f99991331235959Z".as_bytes();
        assert!(GeneralizedTime::from_der(example_bytes).is_err());
    }

    #[test]
    fn invalid_day_generalized_time() {
        let example_bytes = "\x18\x0f99991232235959Z".as_bytes();
        assert!(GeneralizedTime::from_der(example_bytes).is_err());
    }

    #[test]
    fn invalid_hour_generalized_time() {
        let example_bytes = "\x18\x0f99991231245959Z".as_bytes();
        assert!(GeneralizedTime::from_der(example_bytes).is_err());
    }

    #[test]
    fn invalid_minute_generalized_time() {
        let example_bytes = "\x18\x0f99991231236059Z".as_bytes();
        assert!(GeneralizedTime::from_der(example_bytes).is_err());
    }

    #[test]
    fn invalid_second_generalized_time() {
        let example_bytes = "\x18\x0f99991231235960Z".as_bytes();
        assert!(GeneralizedTime::from_der(example_bytes).is_err());
    }
}
