use core::convert::TryInto;

/// Returns whether a buffer is JPEG image data.
pub fn is_jpeg(buf: &[u8]) -> bool {
    buf.len() > 2 && buf[0] == 0xFF && buf[1] == 0xD8 && buf[2] == 0xFF
}

/// Returns whether a buffer is jpg2 image data.
pub fn is_jpeg2000(buf: &[u8]) -> bool {
    buf.len() > 12
        && buf[0] == 0x0
        && buf[1] == 0x0
        && buf[2] == 0x0
        && buf[3] == 0xC
        && buf[4] == 0x6A
        && buf[5] == 0x50
        && buf[6] == 0x20
        && buf[7] == 0x20
        && buf[8] == 0xD
        && buf[9] == 0xA
        && buf[10] == 0x87
        && buf[11] == 0xA
        && buf[12] == 0x0
}

/// Returns whether a buffer is PNG image data.
pub fn is_png(buf: &[u8]) -> bool {
    buf.len() > 3 && buf[0] == 0x89 && buf[1] == 0x50 && buf[2] == 0x4E && buf[3] == 0x47
}

/// Returns whether a buffer is GIF image data.
pub fn is_gif(buf: &[u8]) -> bool {
    buf.len() > 2 && buf[0] == 0x47 && buf[1] == 0x49 && buf[2] == 0x46
}

/// Returns whether a buffer is WEBP image data.
pub fn is_webp(buf: &[u8]) -> bool {
    buf.len() > 11 && buf[8] == 0x57 && buf[9] == 0x45 && buf[10] == 0x42 && buf[11] == 0x50
}

/// Returns whether a buffer is Canon CR2 image data.
pub fn is_cr2(buf: &[u8]) -> bool {
    buf.len() > 10
        && ((buf[0] == 0x49 && buf[1] == 0x49 && buf[2] == 0x2A && buf[3] == 0x0)
            || (buf[0] == 0x4D && buf[1] == 0x4D && buf[2] == 0x0 && buf[3] == 0x2A))
        && buf[8] == 0x43
        && buf[9] == 0x52
        && buf[10] == 0x02 // CR2 major version
}

/// Returns whether a buffer is TIFF image data.
pub fn is_tiff(buf: &[u8]) -> bool {
    buf.len() > 9
        && ((buf[0] == 0x49 && buf[1] == 0x49 && buf[2] == 0x2A && buf[3] == 0x0)
            || (buf[0] == 0x4D && buf[1] == 0x4D && buf[2] == 0x0 && buf[3] == 0x2A))
        && buf[8] != 0x43
        && buf[9] != 0x52
        && !is_cr2(buf) // To avoid conflicts differentiate Tiff from CR2
}

/// Returns whether a buffer is BMP image data.
pub fn is_bmp(buf: &[u8]) -> bool {
    buf.len() > 1 && buf[0] == 0x42 && buf[1] == 0x4D
}

/// Returns whether a buffer is jxr image data.
pub fn is_jxr(buf: &[u8]) -> bool {
    buf.len() > 2 && buf[0] == 0x49 && buf[1] == 0x49 && buf[2] == 0xBC
}

/// Returns whether a buffer is Photoshop PSD image data.
pub fn is_psd(buf: &[u8]) -> bool {
    buf.len() > 3 && buf[0] == 0x38 && buf[1] == 0x42 && buf[2] == 0x50 && buf[3] == 0x53
}

/// Returns whether a buffer is ICO icon image data.
pub fn is_ico(buf: &[u8]) -> bool {
    buf.len() > 3 && buf[0] == 0x00 && buf[1] == 0x00 && buf[2] == 0x01 && buf[3] == 0x00
}

/// Returns whether a buffer is JPEG XL (JXL) image data.
pub fn is_jxl(buf: &[u8]) -> bool {
    (buf.len() > 2 && buf[0] == 0xFF && buf[1] == 0x0A)
        || (buf.len() > 12
            && buf[0] == 0x0
            && buf[1] == 0x0
            && buf[2] == 0x0
            && buf[3] == 0x0C
            && buf[4] == 0x4A
            && buf[5] == 0x58
            && buf[6] == 0x4C
            && buf[7] == 0x20
            && buf[8] == 0x0D
            && buf[9] == 0x0A
            && buf[10] == 0x87
            && buf[11] == 0x0A)
}

/// Returns whether a buffer is HEIF image data.
pub fn is_heif(buf: &[u8]) -> bool {
    if buf.is_empty() {
        return false;
    }

    if !is_isobmff(buf) {
        return false;
    }

    if let Some((major, _minor, compatible)) = get_ftyp(buf) {
        if major == b"heic" || major == b"heix" {
            return true;
        }

        if major == b"mif1" || major == b"msf1" {
            for b in compatible {
                if b == b"heic" {
                    return true;
                }
            }
        }
    }

    false
}

/// Returns whether a buffer is AVIF image data.
pub fn is_avif(buf: &[u8]) -> bool {
    if buf.is_empty() {
        return false;
    }

    if !is_isobmff(buf) {
        return false;
    }

    if let Some((major, _minor, compatible)) = get_ftyp(buf) {
        if major == b"avif" || major == b"avis" {
            return true;
        }

        for b in compatible {
            if b == b"avif" || b == b"avis" {
                return true;
            }
        }
    }

    false
}

// IsISOBMFF checks whether the given buffer represents ISO Base Media File Format data
fn is_isobmff(buf: &[u8]) -> bool {
    if buf.len() < 16 {
        return false;
    }

    if &buf[4..8] != b"ftyp" {
        return false;
    }

    let ftyp_length = u32::from_be_bytes(buf[0..4].try_into().unwrap()) as usize;
    buf.len() >= ftyp_length
}

pub fn is_ora(buf: &[u8]) -> bool {
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
        && buf[38] == 0x69
        && buf[39] == 0x6D
        && buf[40] == 0x61
        && buf[41] == 0x67
        && buf[42] == 0x65
        && buf[43] == 0x2F
        && buf[44] == 0x6F
        && buf[45] == 0x70
        && buf[46] == 0x65
        && buf[47] == 0x6E
        && buf[48] == 0x72
        && buf[49] == 0x61
        && buf[50] == 0x73
        && buf[51] == 0x74
        && buf[52] == 0x65
        && buf[53] == 0x72
}

/// Returns whether a buffer is DjVu image data.
pub fn is_djvu(buf: &[u8]) -> bool {
    buf.len() > 14
        && buf[0] == 0x41
        && buf[1] == 0x54
        && buf[2] == 0x26
        && buf[3] == 0x54
        && buf[4] == 0x46
        && buf[5] == 0x4F
        && buf[6] == 0x52
        && buf[7] == 0x4D
        && buf[12] == 0x44
        && buf[13] == 0x4A
        && buf[14] == 0x56
}

// GetFtyp returns the major brand, minor version and compatible brands of the ISO-BMFF data
fn get_ftyp(buf: &[u8]) -> Option<(&[u8], &[u8], impl Iterator<Item = &[u8]>)> {
    if buf.len() < 16 {
        return None;
    }

    let ftyp_length = u32::from_be_bytes(buf[0..4].try_into().unwrap()) as usize;

    let major = &buf[8..12];
    let minor = &buf[12..16];
    let compatible = buf[16..]
        .chunks_exact(4)
        .take((ftyp_length / 4).saturating_sub(16 / 4));

    Some((major, minor, compatible))
}
