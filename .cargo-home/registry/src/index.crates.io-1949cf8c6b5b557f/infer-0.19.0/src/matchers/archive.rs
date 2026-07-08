use core::convert::{TryFrom, TryInto};

/// Returns whether a buffer is an ePub.
pub fn is_epub(buf: &[u8]) -> bool {
    crate::book::is_epub(buf)
}

/// Returns whether a buffer is a zip archive.
pub fn is_zip(buf: &[u8]) -> bool {
    buf.len() > 3
        && buf[0] == 0x50
        && buf[1] == 0x4B
        && (((buf[2] == 0x3 && buf[3] == 0x4)
            || (buf[2] == 0x5 && buf[3] == 0x6)
            || (buf[2] == 0x7 && buf[3] == 0x8))
            || (
                // winzip
                buf.len() > 7
                    && (buf[2] == 0x30
                        && buf[3] == 0x30
                        && buf[4] == 0x50
                        && buf[5] == 0x4B
                        && buf[6] == 0x3
                        && buf[7] == 0x4)
            ))
}

/// Returns whether a buffer is a tar archive.
pub fn is_tar(buf: &[u8]) -> bool {
    buf.len() > 261
        && buf[257] == 0x75
        && buf[258] == 0x73
        && buf[259] == 0x74
        && buf[260] == 0x61
        && buf[261] == 0x72
}

pub fn is_par2(buf: &[u8]) -> bool {
    buf.len() > 8
        && buf[0] == 0x50
        && buf[1] == 0x41
        && buf[2] == 0x52
        && buf[3] == 0x32
        && buf[4] == 0x00
        && buf[5] == 0x50
        && buf[6] == 0x4B
        && buf[7] == 0x54
}

/// Returns whether a buffer is a RAR archive.
pub fn is_rar(buf: &[u8]) -> bool {
    buf.len() > 6
        && buf[0] == 0x52
        && buf[1] == 0x61
        && buf[2] == 0x72
        && buf[3] == 0x21
        && buf[4] == 0x1A
        && buf[5] == 0x7
        && (buf[6] == 0x0 || buf[6] == 0x1)
}

/// Returns whether a buffer is a gzip archive.
pub fn is_gz(buf: &[u8]) -> bool {
    buf.len() > 2 && buf[0] == 0x1F && buf[1] == 0x8B && buf[2] == 0x8
}

/// Returns whether a buffer is a bzip2 archive.
pub fn is_bz2(buf: &[u8]) -> bool {
    buf.len() > 2 && buf[0] == 0x42 && buf[1] == 0x5A && buf[2] == 0x68
}

/// Returns whether a buffer is a bzip3 archive.
pub fn is_bz3(buf: &[u8]) -> bool {
    buf.len() > 4
        && buf[0] == b'B'
        && buf[1] == b'Z'
        && buf[2] == b'3'
        && buf[3] == b'v'
        && buf[4] == b'1'
}

/// Returns whether a buffer is a 7z archive.
pub fn is_7z(buf: &[u8]) -> bool {
    buf.len() > 5
        && buf[0] == 0x37
        && buf[1] == 0x7A
        && buf[2] == 0xBC
        && buf[3] == 0xAF
        && buf[4] == 0x27
        && buf[5] == 0x1C
}

/// Returns whether a buffer is a PDF.
pub fn is_pdf(buf: &[u8]) -> bool {
    buf.len() > 3 && buf[0] == 0x25 && buf[1] == 0x50 && buf[2] == 0x44 && buf[3] == 0x46
}

/// Returns whether a buffer is a SWF.
pub fn is_swf(buf: &[u8]) -> bool {
    buf.len() > 2 && (buf[0] == 0x43 || buf[0] == 0x46) && buf[1] == 0x57 && buf[2] == 0x53
}

/// Returns whether a buffer is an RTF.
pub fn is_rtf(buf: &[u8]) -> bool {
    buf.len() > 4
        && buf[0] == 0x7B
        && buf[1] == 0x5C
        && buf[2] == 0x72
        && buf[3] == 0x74
        && buf[4] == 0x66
}

/// Returns whether a buffer is a Nintendo NES ROM.
pub fn is_nes(buf: &[u8]) -> bool {
    buf.len() > 3 && buf[0] == 0x4E && buf[1] == 0x45 && buf[2] == 0x53 && buf[3] == 0x1A
}

/// Returns whether a buffer is Google Chrome Extension
pub fn is_crx(buf: &[u8]) -> bool {
    buf.len() > 3 && buf[0] == 0x43 && buf[1] == 0x72 && buf[2] == 0x32 && buf[3] == 0x34
}

/// Returns whether a buffer is a CAB.
pub fn is_cab(buf: &[u8]) -> bool {
    buf.len() > 3
        && ((buf[0] == 0x4D && buf[1] == 0x53 && buf[2] == 0x43 && buf[3] == 0x46)
            || (buf[0] == 0x49 && buf[1] == 0x53 && buf[2] == 0x63 && buf[3] == 0x28))
}

/// Returns whether a buffer is a eot octet stream.
pub fn is_eot(buf: &[u8]) -> bool {
    buf.len() > 35
        && buf[34] == 0x4C
        && buf[35] == 0x50
        && ((buf[8] == 0x02 && buf[9] == 0x00 && buf[10] == 0x01)
            || (buf[8] == 0x01 && buf[9] == 0x00 && buf[10] == 0x00)
            || (buf[8] == 0x02 && buf[9] == 0x00 && buf[10] == 0x02))
}

/// Returns whether a buffer is postscript.
pub fn is_ps(buf: &[u8]) -> bool {
    buf.len() > 1 && buf[0] == 0x25 && buf[1] == 0x21
}

/// Returns whether a buffer is xz archive.
pub fn is_xz(buf: &[u8]) -> bool {
    buf.len() > 5
        && buf[0] == 0xFD
        && buf[1] == 0x37
        && buf[2] == 0x7A
        && buf[3] == 0x58
        && buf[4] == 0x5A
        && buf[5] == 0x00
}

/// Returns whether a buffer is a sqlite3 database.
///
/// # Example
///
/// ```rust
/// use std::fs;
/// assert!(infer::archive::is_sqlite(&fs::read("testdata/sample.db").unwrap()));
/// ```
pub fn is_sqlite(buf: &[u8]) -> bool {
    buf.len() > 3 && buf[0] == 0x53 && buf[1] == 0x51 && buf[2] == 0x4C && buf[3] == 0x69
}

/// Returns whether a buffer is a deb archive.
pub fn is_deb(buf: &[u8]) -> bool {
    buf.len() > 20
        && buf[0] == 0x21
        && buf[1] == 0x3C
        && buf[2] == 0x61
        && buf[3] == 0x72
        && buf[4] == 0x63
        && buf[5] == 0x68
        && buf[6] == 0x3E
        && buf[7] == 0x0A
        && buf[8] == 0x64
        && buf[9] == 0x65
        && buf[10] == 0x62
        && buf[11] == 0x69
        && buf[12] == 0x61
        && buf[13] == 0x6E
        && buf[14] == 0x2D
        && buf[15] == 0x62
        && buf[16] == 0x69
        && buf[17] == 0x6E
        && buf[18] == 0x61
        && buf[19] == 0x72
        && buf[20] == 0x79
}

/// Returns whether a buffer is a ar archive.
pub fn is_ar(buf: &[u8]) -> bool {
    buf.len() > 6
        && buf[0] == 0x21
        && buf[1] == 0x3C
        && buf[2] == 0x61
        && buf[3] == 0x72
        && buf[4] == 0x63
        && buf[5] == 0x68
        && buf[6] == 0x3E
}

/// Returns whether a buffer is a z archive.
pub fn is_z(buf: &[u8]) -> bool {
    buf.len() > 1 && buf[0] == 0x1F && (buf[1] == 0xA0 || buf[1] == 0x9D)
}

/// Returns whether a buffer is a lzip archive.
pub fn is_lz(buf: &[u8]) -> bool {
    buf.len() > 3 && buf[0] == 0x4C && buf[1] == 0x5A && buf[2] == 0x49 && buf[3] == 0x50
}

/// Returns whether a buffer is an RPM.
pub fn is_rpm(buf: &[u8]) -> bool {
    buf.len() > 96 && buf[0] == 0xED && buf[1] == 0xAB && buf[2] == 0xEE && buf[3] == 0xDB
}

/// Returns whether a buffer is a dcm archive.
pub fn is_dcm(buf: &[u8]) -> bool {
    buf.len() > 131 && buf[128] == 0x44 && buf[129] == 0x49 && buf[130] == 0x43 && buf[131] == 0x4D
}

const ZSTD_SKIP_START: usize = 0x184D2A50;
const ZSTD_SKIP_MASK: usize = 0xFFFFFFF0;

/// Returns whether a buffer is a Zstd archive.
// Zstandard compressed data is made of one or more frames.
// There are two frame formats defined by Zstandard: Zstandard frames and Skippable frames.
// See more details from https://tools.ietf.org/id/draft-kucherawy-dispatch-zstd-00.html#rfc.section.2
pub fn is_zst(buf: &[u8]) -> bool {
    if buf.len() > 3 && buf[0] == 0x28 && buf[1] == 0xB5 && buf[2] == 0x2F && buf[3] == 0xFD {
        return true;
    }

    if buf.len() < 8 {
        return false;
    }

    let magic = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    let Ok(magic) = usize::try_from(magic) else {
        return false;
    };

    if magic & ZSTD_SKIP_MASK != ZSTD_SKIP_START {
        return false;
    }

    let data_len = u32::from_le_bytes(buf[4..8].try_into().unwrap());
    let Ok(data_len) = usize::try_from(data_len) else {
        return false;
    };

    if buf.len() < 8 + data_len {
        return false;
    }

    let next_frame = &buf[8 + data_len..];
    is_zst(next_frame)
}

/// Returns whether a buffer is a LZ4 archive.
// LZ4 compressed data is made of one or more frames.
// There are two frame formats defined by LZ4: LZ4 Frame format and Skippable frames.
// See more details from https://github.com/lz4/lz4/blob/v1.9.4/doc/lz4_Frame_format.md
pub fn is_lz4(buf: &[u8]) -> bool {
    if buf.len() > 3 && buf[0] == 0x04 && buf[1] == 0x22 && buf[2] == 0x4D && buf[3] == 0x18 {
        return true;
    }

    if buf.len() < 8 {
        return false;
    }

    let magic = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    let Ok(magic) = usize::try_from(magic) else {
        return false;
    };

    if magic & ZSTD_SKIP_MASK != ZSTD_SKIP_START {
        return false;
    }

    let data_len = u32::from_le_bytes(buf[4..8].try_into().unwrap());
    let Ok(data_len) = usize::try_from(data_len) else {
        return false;
    };

    if buf.len() < 8 + data_len {
        return false;
    }

    let next_frame = &buf[8 + data_len..];
    is_lz4(next_frame)
}

/// Returns whether a buffer is a MSI Windows Installer archive.
pub fn is_msi(buf: &[u8]) -> bool {
    buf.len() > 7
        && buf[0] == 0xD0
        && buf[1] == 0xCF
        && buf[2] == 0x11
        && buf[3] == 0xE0
        && buf[4] == 0xA1
        && buf[5] == 0xB1
        && buf[6] == 0x1A
        && buf[7] == 0xE1
}

/// Returns whether a buffer is a CPIO archive.
pub fn is_cpio(buf: &[u8]) -> bool {
    (buf.len() > 1
        && ((buf[0] == 0xC7 && buf[1] == 0x71) // little endian, old format
        || (buf[0] == 0x71 && buf[1] == 0xC7))) // big endian, old format
    || (buf.len() > 6
        && buf[0] == 0x30
        && buf[1] == 0x37
        && buf[2] == 0x30
        && buf[3] == 0x37
        && buf[4] == 0x30
        && buf[5] == 0x31) // newc format
}
