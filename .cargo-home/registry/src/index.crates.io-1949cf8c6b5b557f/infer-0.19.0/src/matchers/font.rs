/// Returns whether a buffer is WOFF font data.
pub fn is_woff(buf: &[u8]) -> bool {
    buf.len() > 7
        && buf[0] == 0x77
        && buf[1] == 0x4F
        && buf[2] == 0x46
        && buf[3] == 0x46
        && buf[4] == 0x00
        && buf[5] == 0x01
        && buf[6] == 0x00
        && buf[7] == 0x00
}

/// Returns whether a buffer is WOFF2 font data.
pub fn is_woff2(buf: &[u8]) -> bool {
    buf.len() > 7
        && buf[0] == 0x77
        && buf[1] == 0x4F
        && buf[2] == 0x46
        && buf[3] == 0x32
        && buf[4] == 0x00
        && buf[5] == 0x01
        && buf[6] == 0x00
        && buf[7] == 0x00
}

/// Returns whether a buffer is TTF font data.
pub fn is_ttf(buf: &[u8]) -> bool {
    buf.len() > 4
        && buf[0] == 0x00
        && buf[1] == 0x01
        && buf[2] == 0x00
        && buf[3] == 0x00
        && buf[4] == 0x00
}

/// Returns whether a buffer is OTF font data.
pub fn is_otf(buf: &[u8]) -> bool {
    buf.len() > 4
        && buf[0] == 0x4F
        && buf[1] == 0x54
        && buf[2] == 0x54
        && buf[3] == 0x4F
        && buf[4] == 0x00
}
