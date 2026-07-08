/// Choose how to find an appropriate unit based on a base of 2 or 10.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum UnitType {
    /// KiB, MiB, ..., etc.
    Binary,
    /// KB, MB, ..., etc.
    Decimal,
    /// Use both binary and decimal, choose the closest one.
    Both,
}
