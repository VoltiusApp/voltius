/// Safely truncate an unsigned integer value to shorter representation
pub trait Truncate<T> {
    /// Truncate value to the width of `Self`.
    fn truncate(x: T) -> Self;
}

macro_rules! define_truncate {
    ($from:ident, $to:ident) => {
        impl Truncate<$from> for $to {
            // Truncation should always function as intended here:
            // - we ensure `$to` is small enough to infallibly convert to `$from` via the
            //   `$from::from($to::MAX)` conversion, which will fail if not widening.
            // - we are deliberately masking to the smaller size, i.e. truncation is intentional
            //   (though that's not enough for `clippy` for some reason). Arguably the truncation
            //   of the `as` cast is sufficient, but this makes it explicit
            #[allow(clippy::cast_possible_truncation)]
            fn truncate(x: $from) -> $to {
                (x & $from::from($to::MAX)) as $to
            }
        }
    };
}

define_truncate!(u32, u16);
define_truncate!(u64, u16);
define_truncate!(u64, u32);
define_truncate!(u128, u8);
define_truncate!(u128, u16);
define_truncate!(u128, u32);
define_truncate!(usize, u8);
define_truncate!(usize, u16);
