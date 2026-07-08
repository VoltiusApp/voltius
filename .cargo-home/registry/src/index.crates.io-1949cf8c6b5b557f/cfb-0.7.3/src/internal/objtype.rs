use crate::internal::consts;

//===========================================================================//

/// The type of a directory entry.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ObjType {
    Unallocated,
    Storage,
    Stream,
    Root,
}

impl ObjType {
    pub fn as_byte(&self) -> u8 {
        match self {
            ObjType::Unallocated => consts::OBJ_TYPE_UNALLOCATED,
            ObjType::Storage => consts::OBJ_TYPE_STORAGE,
            ObjType::Stream => consts::OBJ_TYPE_STREAM,
            ObjType::Root => consts::OBJ_TYPE_ROOT,
        }
    }

    pub fn from_byte(byte: u8) -> Option<ObjType> {
        if byte == consts::OBJ_TYPE_UNALLOCATED {
            Some(ObjType::Unallocated)
        } else if byte == consts::OBJ_TYPE_STORAGE {
            Some(ObjType::Storage)
        } else if byte == consts::OBJ_TYPE_STREAM {
            Some(ObjType::Stream)
        } else if byte == consts::OBJ_TYPE_ROOT {
            Some(ObjType::Root)
        } else {
            None
        }
    }
}

//===========================================================================//

#[cfg(test)]
mod tests {
    use super::ObjType;

    #[test]
    fn round_trip() {
        for &obj_type in &[
            ObjType::Unallocated,
            ObjType::Storage,
            ObjType::Stream,
            ObjType::Root,
        ] {
            assert_eq!(ObjType::from_byte(obj_type.as_byte()), Some(obj_type));
        }
    }
}

//===========================================================================//
