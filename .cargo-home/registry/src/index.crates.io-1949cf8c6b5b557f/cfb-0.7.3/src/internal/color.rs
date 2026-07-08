use crate::internal::consts;

//===========================================================================//

/// The "color" of a directory entry (which can be used for maintaining a
/// red-black tree).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Color {
    Red,
    Black,
}

impl Color {
    pub fn as_byte(&self) -> u8 {
        match self {
            Color::Red => consts::COLOR_RED,
            Color::Black => consts::COLOR_BLACK,
        }
    }

    pub fn from_byte(byte: u8) -> Option<Color> {
        if byte == consts::COLOR_RED {
            Some(Color::Red)
        } else if byte == consts::COLOR_BLACK {
            Some(Color::Black)
        } else {
            None
        }
    }
}

//===========================================================================//

#[cfg(test)]
mod tests {
    use super::Color;

    #[test]
    fn round_trip() {
        for &color in &[Color::Red, Color::Black] {
            assert_eq!(Color::from_byte(color.as_byte()), Some(color));
        }
    }
}

//===========================================================================//
