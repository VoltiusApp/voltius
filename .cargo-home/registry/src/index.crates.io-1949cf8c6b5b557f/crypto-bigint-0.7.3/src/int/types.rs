//! Selection of [`Int`] types.
//! todo: replace with macro implementation once serde is set up.

use crate::Int;

cpubits::cpubits! {
    32 => {
        /// Signed bit integer.
        pub type I64 = Int<2>;

        /// Signed bit integer.
        pub type I128 = Int<4>;

        /// Signed bit integer.
        pub type I256 = Int<8>;

        /// Signed bit integer.
        pub type I512 = Int<16>;

        /// Signed bit integer.
        pub type I1024 = Int<32>;

        /// Signed bit integer.
        pub type I2048 = Int<64>;

        /// Signed bit integer.
        pub type I4096 = Int<128>;
    }
    64 => {
        /// Signed bit integer.
        pub type I64 = Int<1>;

        /// Signed bit integer.
        pub type I128 = Int<2>;

        /// Signed bit integer.
        pub type I256 = Int<4>;

        /// Signed bit integer.
        pub type I512 = Int<8>;

        /// Signed bit integer.
        pub type I1024 = Int<16>;

        /// Signed bit integer.
        pub type I2048 = Int<32>;

        /// Signed bit integer.
        pub type I4096 = Int<64>;
    }
}
