#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

//===========================================================================//

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
#[cfg_attr(feature = "serde", derive(Deserialize, Serialize))]
/// The type of resource stored in an ICO/CUR file.
pub enum ResourceType {
    /// Plain images (ICO files)
    Icon,
    /// Images with cursor hotspots (CUR files)
    Cursor,
}

impl ResourceType {
    pub(crate) fn from_number(number: u16) -> Option<ResourceType> {
        match number {
            1 => Some(ResourceType::Icon),
            2 => Some(ResourceType::Cursor),
            _ => None,
        }
    }

    pub(crate) fn number(&self) -> u16 {
        match *self {
            ResourceType::Icon => 1,
            ResourceType::Cursor => 2,
        }
    }
}

//===========================================================================//

#[cfg(test)]
mod tests {
    use super::ResourceType;

    #[test]
    fn resource_type_round_trip() {
        let restypes = &[ResourceType::Icon, ResourceType::Cursor];
        for &restype in restypes.iter() {
            assert_eq!(
                ResourceType::from_number(restype.number()),
                Some(restype)
            );
        }
    }
}

//===========================================================================//
