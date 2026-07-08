/// Returns whether a buffer is an ePub.
pub fn is_epub(buf: &[u8]) -> bool {
    buf.len() > 57
        && buf[0] == 0x50
        && buf[1] == 0x4B
        && buf[2] == 0x3
        && buf[3] == 0x4
        && buf[30] == 0x6D
        && buf[31] == 0x69
        && buf[32] == 0x6D
        && buf[33] == 0x65
        && buf[34] == 0x74
        && buf[35] == 0x79
        && buf[36] == 0x70
        && buf[37] == 0x65
        && buf[38] == 0x61
        && buf[39] == 0x70
        && buf[40] == 0x70
        && buf[41] == 0x6C
        && buf[42] == 0x69
        && buf[43] == 0x63
        && buf[44] == 0x61
        && buf[45] == 0x74
        && buf[46] == 0x69
        && buf[47] == 0x6F
        && buf[48] == 0x6E
        && buf[49] == 0x2F
        && buf[50] == 0x65
        && buf[51] == 0x70
        && buf[52] == 0x75
        && buf[53] == 0x62
        && buf[54] == 0x2B
        && buf[55] == 0x7A
        && buf[56] == 0x69
        && buf[57] == 0x70
}

/// Returns whether a buffer is a mobi.
pub fn is_mobi(buf: &[u8]) -> bool {
    buf.len() > 67
        // BOOK
        && buf[60] == 0x42
        && buf[61] == 0x4F
        && buf[62] == 0x4F
        && buf[63] == 0x4B
        // MOBI
        && buf[64] == 0x4D
        && buf[65] == 0x4F
        && buf[66] == 0x42
        && buf[67] == 0x49
}
