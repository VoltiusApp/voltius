use super::Bit;
#[cfg(feature = "u128")]
use super::RONNABIT;

/// Constant `Bit`s.
#[rustfmt::skip]
impl Bit {
    /// One bit.
    pub const BIT: Bit = Bit(1);

    /// 1 Kbit = 10<sup>3</sup> bits.
    pub const KILOBIT: Bit = Bit(1_000);
    /// 1 Mbit = 10<sup>6</sup> bits.
    pub const MEGABIT: Bit = Bit(1_000_000);
    /// 1 Gbit = 10<sup>9</sup> bits.
    pub const GIGABIT: Bit = Bit(1_000_000_000);
    /// 1 Tbit = 10<sup>12</sup> bits.
    pub const TERABIT: Bit = Bit(1_000_000_000_000);
    /// 1 Pbit = 10<sup>15</sup> bits.
    pub const PETABIT: Bit = Bit(1_000_000_000_000_000);
    /// 1 Ebit = 10<sup>18</sup> bits.
    pub const EXABIT: Bit = Bit(1_000_000_000_000_000_000);
    #[cfg(feature = "u128")]
    /// 1 Zbit = 10<sup>21</sup> bits.
    pub const ZETTABIT: Bit = Bit(1_000_000_000_000_000_000_000);
    #[cfg(feature = "u128")]
    /// 1 Ybit = 10<sup>24</sup> bits.
    pub const YOTTABIT: Bit = Bit(1_000_000_000_000_000_000_000_000);

    /// 1 Kibit = 2<sup>10</sup> bits.
    pub const KIBIBIT: Bit = Bit(1 << 10);
    /// 1 Mibit = 2<sup>20</sup> bits.
    pub const MEBIBIT: Bit = Bit(1 << 20);
    /// 1 Gibit = 2<sup>30</sup> bits.
    pub const GIBIBIT: Bit = Bit(1 << 30);
    /// 1 Tibit = 2<sup>40</sup> bits.
    pub const TEBIBIT: Bit = Bit(1 << 40);
    /// 1 Pibit = 2<sup>50</sup> bits.
    pub const PEBIBIT: Bit = Bit(1 << 50);
    /// 1 Eibit = 2<sup>60</sup> bits.
    pub const EXBIBIT: Bit = Bit(1 << 60);
    #[cfg(feature = "u128")]
    /// 1 Zibit = 2<sup>70</sup> bits.
    pub const ZEBIBIT: Bit = Bit(1 << 70);
    #[cfg(feature = "u128")]
    /// 1 Yibit = 2<sup>80</sup> bits.
    pub const YOBIBIT: Bit = Bit(1 << 80);


    /// 1 KB = 8 * 10<sup>3</sup> bits.
    pub const KILOBYTE: Bit = Bit::KILOBIT.mul_8();
    /// 1 MB = 8 * 10<sup>6</sup> bits.
    pub const MEGABYTE: Bit = Bit::MEGABIT.mul_8();
    /// 1 GB = 8 * 10<sup>9</sup> bits.
    pub const GIGABYTE: Bit = Bit::GIGABIT.mul_8();
    /// 1 TB = 8 * 10<sup>12</sup> bits.
    pub const TERABYTE: Bit = Bit::TERABIT.mul_8();
    /// 1 PB = 8 * 10<sup>15</sup> bits.
    pub const PETABYTE: Bit = Bit::PETABIT.mul_8();
    /// 1 EB = 8 * 10<sup>18</sup> bits.
    pub const EXABYTE: Bit = Bit::EXABIT.mul_8();
    #[cfg(feature = "u128")]
    /// 1 ZB = 8 * 10<sup>21</sup> bits.
    pub const ZETTABYTE: Bit = Bit::ZETTABIT.mul_8();
    #[cfg(feature = "u128")]
    /// 1 YB = 8 * 10<sup>24</sup> bits.
    pub const YOTTABYTE: Bit = Bit::YOTTABIT.mul_8();


    /// 1 KiB = 2<sup>13</sup> bits.
    pub const KIBIBYTE: Bit = Bit::KIBIBIT.mul_8();
    /// 1 MiB = 2<sup>23</sup> bits.
    pub const MEBIBYTE: Bit = Bit::MEBIBIT.mul_8();
    /// 1 GiB = 2<sup>33</sup> bits.
    pub const GIBIBYTE: Bit = Bit::GIBIBIT.mul_8();
    /// 1 TiB = 2<sup>43</sup> bits.
    pub const TEBIBYTE: Bit = Bit::TEBIBIT.mul_8();
    /// 1 PiB = 2<sup>53</sup> bits.
    pub const PEBIBYTE: Bit = Bit::PEBIBIT.mul_8();
    /// 1 EiB = 2<sup>63</sup> bits.
    pub const EXBIBYTE: Bit = Bit::EXBIBIT.mul_8();
    #[cfg(feature = "u128")]
    /// 1 ZiB = 2<sup>73</sup> bits.
    pub const ZEBIBYTE: Bit = Bit::ZEBIBIT.mul_8();
    #[cfg(feature = "u128")]
    /// 1 YiB = 2<sup>83</sup> bits.
    pub const YOBIBYTE: Bit = Bit::YOBIBIT.mul_8();

    /// 0 bit.
    pub const MIN: Bit = Bit(0);
    /// **10<sup>27</sup> - 1** bits if the `u128` feature is enabled, or **2<sup>64</sup> - 1** otherwise.
    pub const MAX: Bit = {
        #[cfg(feature = "u128")]
        {
            Bit(RONNABIT - 1)
        }

        #[cfg(not(feature = "u128"))]
        {
            Bit(u64::MAX)
        }
    };
}
