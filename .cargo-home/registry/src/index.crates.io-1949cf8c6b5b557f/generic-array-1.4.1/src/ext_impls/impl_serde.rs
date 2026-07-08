//! Serde serialization/deserialization implementation

use crate::{ArrayLength, GenericArray, IntrusiveArrayBuilder};
use core::fmt;
use core::marker::PhantomData;

use serde_core::de::{self, SeqAccess, Visitor};
use serde_core::{ser::SerializeTuple, Deserialize, Deserializer, Serialize, Serializer};

impl<T, N: ArrayLength> Serialize for GenericArray<T, N>
where
    T: Serialize,
{
    #[inline]
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut tup = serializer.serialize_tuple(N::USIZE)?;
        for el in self {
            tup.serialize_element(el)?;
        }

        tup.end()
    }
}

struct GAVisitor<T, N> {
    _t: PhantomData<T>,
    _n: PhantomData<N>,
}

// to avoid extra computation when testing for extra elements in the sequence
struct Dummy;
impl<'de> Deserialize<'de> for Dummy {
    fn deserialize<D>(_deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(Dummy)
    }
}

impl<'de, T, N: ArrayLength> Visitor<'de> for GAVisitor<T, N>
where
    T: Deserialize<'de>,
{
    type Value = GenericArray<T, N>;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        write!(formatter, "struct GenericArray<T, U{}>", N::USIZE)
    }

    fn visit_seq<A>(self, mut seq: A) -> Result<GenericArray<T, N>, A::Error>
    where
        A: SeqAccess<'de>,
    {
        match seq.size_hint() {
            Some(n) if n != N::USIZE => {
                return Err(de::Error::invalid_length(n, &self));
            }
            _ => {}
        }

        unsafe {
            let mut dst = core::mem::MaybeUninit::<GenericArray<T, N>>::uninit();
            let mut builder = IntrusiveArrayBuilder::new_alt(&mut dst);

            let (build_iter, position) = builder.iter_position();

            for dst in build_iter {
                match seq.next_element()? {
                    Some(el) => {
                        dst.write(el);
                        *position += 1;
                    }
                    None => break,
                }
            }

            if *position == N::USIZE {
                if seq.size_hint() != Some(0) && seq.next_element::<Dummy>()?.is_some() {
                    return Err(de::Error::invalid_length(*position + 1, &self));
                }

                return Ok(builder.finish_and_assume_init());
            }

            Err(de::Error::invalid_length(*position, &self))
        }
    }
}

impl<'de, T, N: ArrayLength> Deserialize<'de> for GenericArray<T, N>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<GenericArray<T, N>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let visitor = GAVisitor {
            _t: PhantomData,
            _n: PhantomData,
        };
        deserializer.deserialize_tuple(N::USIZE, visitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize() {
        let array = GenericArray::<u8, typenum::U2>::default();
        let serialized = bincode::serialize(&array);
        assert!(serialized.is_ok());
    }

    #[test]
    fn test_deserialize() {
        let mut array = GenericArray::<u8, typenum::U2>::default();
        array[0] = 1;
        array[1] = 2;
        let serialized = bincode::serialize(&array).unwrap();
        let deserialized = bincode::deserialize::<GenericArray<u8, typenum::U2>>(&serialized);
        assert!(deserialized.is_ok());
        let array = deserialized.unwrap();
        assert_eq!(array[0], 1);
        assert_eq!(array[1], 2);
    }

    #[test]
    fn test_serialized_size() {
        let array = GenericArray::<u8, typenum::U1>::default();
        let size = bincode::serialized_size(&array).unwrap();
        assert_eq!(size, 1);
    }

    #[test]
    #[should_panic]
    fn test_too_many() {
        let serialized = "[1, 2, 3, 4, 5]";
        let _ = serde_json::from_str::<GenericArray<u8, typenum::U4>>(serialized).unwrap();
    }
}
