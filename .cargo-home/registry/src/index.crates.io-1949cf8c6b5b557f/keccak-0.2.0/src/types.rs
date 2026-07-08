//! Helper type aliases.
use crate::PLEN;

/// 200-bit Keccak state.
pub type State200 = [u8; PLEN];
/// 400-bit Keccak state.
pub type State400 = [u16; PLEN];
/// 800-bit Keccak state.
pub type State800 = [u32; PLEN];
/// 1600-bit Keccak state.
pub type State1600 = [u64; PLEN];

/// A Keccak function which permutates [`State200`].
pub type Fn200 = fn(&mut State200);
/// A Keccak function which permutates [`State400`].
pub type Fn400 = fn(&mut State400);
/// A Keccak function which permutates [`State800`].
pub type Fn800 = fn(&mut State800);
/// A Keccak function which permutates [`State1600`].
pub type Fn1600 = fn(&mut State1600);

#[cfg(feature = "parallel")]
mod parallel {
    use super::State1600;
    use crate::Backend;
    use hybrid_array::Array;

    /// 1600xN-bit state processed in parallel by a [`Backend`] implementation.
    pub type ParState1600<B> = Array<State1600, <B as Backend>::ParSize1600>;
    /// A Keccak function which permutates [`ParState1600`].
    pub type ParFn1600<B> = fn(&mut ParState1600<B>);
}

#[cfg(feature = "parallel")]
pub use parallel::*;
