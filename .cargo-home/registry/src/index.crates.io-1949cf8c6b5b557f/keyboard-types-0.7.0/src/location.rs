/// The location attribute contains an indication of the logical location
/// of the key on the device.
#[derive(Copy, Clone, Debug, Eq, Hash, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Location {
    /// The key activation MUST NOT be distinguished as the left or right
    /// version of the key, and (other than the NumLock key) did not
    /// originate from the numeric keypad (or did not originate with a
    /// virtual key corresponding to the numeric keypad).
    Standard = 0x00,
    /// The key activated originated from the left key location (when there
    /// is more than one possible location for this key).
    Left = 0x01,
    /// The key activation originated from the right key location (when
    /// there is more than one possible location for this key).
    Right = 0x02,
    /// The key activation originated on the numeric keypad or with a virtual
    /// key corresponding to the numeric keypad (when there is more than one
    /// possible location for this key). Note that the NumLock key should
    /// always be encoded with a location of `Location::Standard`.
    Numpad = 0x03,
}
