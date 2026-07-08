use super::Byte;
#[cfg(feature = "u128")]
use super::RONNABYTE;

/// Constant `Byte`s.
#[rustfmt::skip]
impl Byte {
    /// One byte.
    pub const BYTE: Byte = Byte(1);

    /// 1 KB = 10<sup>3</sup> bytes.
    pub const KILOBYTE: Byte = Byte(1_000);
    /// 1 MB = 10<sup>6</sup> bytes.
    pub const MEGABYTE: Byte = Byte(1_000_000);
    /// 1 GB = 10<sup>9</sup> bytes.
    pub const GIGABYTE: Byte = Byte(1_000_000_000);
    /// 1 TB = 10<sup>12</sup> bytes.
    pub const TERABYTE: Byte = Byte(1_000_000_000_000);
    /// 1 PB = 10<sup>15</sup> bytes.
    pub const PETABYTE: Byte = Byte(1_000_000_000_000_000);
    /// 1 EB = 10<sup>18</sup> bytes.
    pub const EXABYTE: Byte = Byte(1_000_000_000_000_000_000);
    #[cfg(feature = "u128")]
    /// 1 ZB = 10<sup>21</sup> bytes.
    pub const ZETTABYTE: Byte = Byte(1_000_000_000_000_000_000_000);
    #[cfg(feature = "u128")]
    /// 1 YB = 10<sup>24</sup> bytes.
    pub const YOTTABYTE: Byte = Byte(1_000_000_000_000_000_000_000_000);

    /// 1 KiB = 2<sup>10</sup> bytes.
    pub const KIBIBYTE: Byte = Byte(1 << 10);
    /// 1 MiB = 2<sup>20</sup> bytes.
    pub const MEBIBYTE: Byte = Byte(1 << 20);
    /// 1 GiB = 2<sup>30</sup> bytes.
    pub const GIBIBYTE: Byte = Byte(1 << 30);
    /// 1 TiB = 2<sup>40</sup> bytes.
    pub const TEBIBYTE: Byte = Byte(1 << 40);
    /// 1 PiB = 2<sup>50</sup> bytes.
    pub const PEBIBYTE: Byte = Byte(1 << 50);
    /// 1 EiB = 2<sup>60</sup> bytes.
    pub const EXBIBYTE: Byte = Byte(1 << 60);
    #[cfg(feature = "u128")]
    /// 1 ZiB = 2<sup>70</sup> bytes.
    pub const ZEBIBYTE: Byte = Byte(1 << 70);
    #[cfg(feature = "u128")]
    /// 1 YiB = 2<sup>80</sup> bytes.
    pub const YOBIBYTE: Byte = Byte(1 << 80);


    /// 1 Kbit = 125 bytes.
    pub const KILOBIT: Byte = Byte::KILOBYTE.div_8();
    /// 1 Mbit = 125 * 10<sup>3</sup> bytes.
    pub const MEGABIT: Byte = Byte::MEGABYTE.div_8();
    /// 1 Gbit = 125 * 10<sup>6</sup> bytes.
    pub const GIGABIT: Byte = Byte::GIGABYTE.div_8();
    /// 1 Tbit = 125 * 10<sup>9</sup> bytes.
    pub const TERABIT: Byte = Byte::TERABYTE.div_8();
    /// 1 Pbit = 125 * 10<sup>12</sup> bytes.
    pub const PETABIT: Byte = Byte::PETABYTE.div_8();
    /// 1 Ebit = 125 * 10<sup>15</sup> bytes.
    pub const EXABIT: Byte = Byte::EXABYTE.div_8();
    #[cfg(feature = "u128")]
    /// 1 Zbit = 125 * 10<sup>18</sup> bytes.
    pub const ZETTABIT: Byte = Byte::ZETTABYTE.div_8();
    #[cfg(feature = "u128")]
    /// 1 Ybit = 125 * 10<sup>21</sup> bytes.
    pub const YOTTABIT: Byte = Byte::YOTTABYTE.div_8();


    /// 1 Kibit = 2<sup>7</sup> bytes.
    pub const KIBIBIT: Byte = Byte::KIBIBYTE.div_8();
    /// 1 Mibit = 2<sup>17</sup> bytes.
    pub const MEBIBIT: Byte = Byte::MEBIBYTE.div_8();
    /// 1 Gibit = 2<sup>27</sup> bytes.
    pub const GIBIBIT: Byte = Byte::GIBIBYTE.div_8();
    /// 1 Tibit = 2<sup>37</sup> bytes.
    pub const TEBIBIT: Byte = Byte::TEBIBYTE.div_8();
    /// 1 Pibit = 2<sup>47</sup> bytes.
    pub const PEBIBIT: Byte = Byte::PEBIBYTE.div_8();
    /// 1 Eibit = 2<sup>57</sup> bytes.
    pub const EXBIBIT: Byte = Byte::EXBIBYTE.div_8();
    #[cfg(feature = "u128")]
    /// 1 Zibit = 2<sup>67</sup> bytes.
    pub const ZEBIBIT: Byte = Byte::ZEBIBYTE.div_8();
    #[cfg(feature = "u128")]
    /// 1 Yibit = 2<sup>77</sup> bytes.
    pub const YOBIBIT: Byte = Byte::YOBIBYTE.div_8();

    /// 0 byte.
    pub const MIN: Byte = Byte(0);
    /// **10<sup>27</sup> - 1** bytes if the `u128` feature is enabled, or **2<sup>64</sup> - 1** otherwise.
    pub const MAX: Byte = {
        #[cfg(feature = "u128")]
        {
            Byte(RONNABYTE - 1)
        }

        #[cfg(not(feature = "u128"))]
        {
            Byte(u64::MAX)
        }
    };
}
