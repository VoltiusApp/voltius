extern crate ico;

//===========================================================================//

#[test]
fn encode_bmp_with_two_colors() {
    // This image has only two colors, so it should have 1 bpp when encoded as
    // a BMP.
    let rgba: &[u8] = b"\xff\x00\x00\xff\x00\xff\x00\xff\
                        \xff\x00\x00\xff\xff\x00\x00\xff";
    let image = ico::IconImage::from_rgba_data(2, 2, rgba.to_vec());
    let entry = ico::IconDirEntry::encode_as_bmp(&image).unwrap();
    assert!(!entry.is_png());
    assert_eq!(entry.bits_per_pixel(), 1);
    assert_eq!(entry.decode().unwrap().rgba_data(), rgba);
}

#[test]
fn encode_bmp_with_ten_colors() {
    // This image has 10 colors (which is more than 2 and less than 16), so it
    // should have 4 bpp when encoded as a BMP.
    let mut rgba = Vec::<u8>::new();
    for index in 0..(13 * 7) {
        rgba.extend_from_slice(&[(index % 10) as u8, 0, 0, 0xff]);
    }
    let image = ico::IconImage::from_rgba_data(13, 7, rgba.to_vec());
    let entry = ico::IconDirEntry::encode_as_bmp(&image).unwrap();
    assert!(!entry.is_png());
    assert_eq!(entry.bits_per_pixel(), 4);
    assert_eq!(entry.decode().unwrap().rgba_data(), rgba.as_slice());
}

#[test]
fn encode_bmp_with_fifty_colors() {
    // This image has 50 colors (which is more than 16 and less than 256), so
    // it should have 8 bpp when encoded as a BMP.
    let mut rgba = Vec::<u8>::new();
    for index in 0..(31 * 29) {
        rgba.extend_from_slice(&[(index % 50) as u8, 0, 0, 0xff]);
    }
    let image = ico::IconImage::from_rgba_data(31, 29, rgba.to_vec());
    let entry = ico::IconDirEntry::encode_as_bmp(&image).unwrap();
    assert!(!entry.is_png());
    assert_eq!(entry.bits_per_pixel(), 8);
    assert_eq!(entry.decode().unwrap().rgba_data(), rgba.as_slice());
}

#[test]
fn encode_small_bmp_with_fifty_colors() {
    // This image has 50 colors, like the above test, but only 50 pixels.  So
    // although it could be encoded at 8 bpp, it's actually more efficient to
    // encode it at 24 bpp (so that we can omit the 256-entry color table).
    let mut rgba = Vec::<u8>::new();
    for index in 0..(10 * 5) {
        rgba.extend_from_slice(&[(index % 50) as u8, 0, 0, 0xff]);
    }
    let image = ico::IconImage::from_rgba_data(10, 5, rgba.to_vec());
    let entry = ico::IconDirEntry::encode_as_bmp(&image).unwrap();
    assert!(!entry.is_png());
    assert_eq!(entry.bits_per_pixel(), 24);
    assert_eq!(entry.decode().unwrap().rgba_data(), rgba.as_slice());
}

#[test]
fn encode_bmp_with_five_hundred_colors() {
    // This image has 500 colors (which is more than 256), so it should have 24
    // bpp when encoded as a BMP.
    let mut rgba = Vec::<u8>::new();
    for index in 0..(24 * 24) {
        let color = [(index % 100) as u8, ((index / 100) % 5) as u8, 0, 0xff];
        rgba.extend_from_slice(&color);
    }
    let image = ico::IconImage::from_rgba_data(24, 24, rgba.to_vec());
    let entry = ico::IconDirEntry::encode_as_bmp(&image).unwrap();
    assert!(!entry.is_png());
    assert_eq!(entry.bits_per_pixel(), 24);
    assert_eq!(entry.decode().unwrap().rgba_data(), rgba.as_slice());
}

#[test]
fn encode_bmp_with_nonbinary_alpha() {
    // Although this image has only two colors, it has alpha values between 0
    // and 255, and BMP can only support that at 32 bpp.
    let rgba: &[u8] = b"\xff\x00\x00\x7f\x00\xff\x00\x7f\
                        \xff\x00\x00\x7f\xff\x00\x00\x7f";
    let image = ico::IconImage::from_rgba_data(2, 2, rgba.to_vec());
    let entry = ico::IconDirEntry::encode_as_bmp(&image).unwrap();
    assert!(!entry.is_png());
    assert_eq!(entry.bits_per_pixel(), 32);
    assert_eq!(entry.decode().unwrap().rgba_data(), rgba);
}

//===========================================================================//

#[test]
fn encode_png_with_alpha_channel() {
    // This image has 500 colors, including various alpha values.  It should
    // have 32 bpp when encoded as a PNG.
    let mut rgba = Vec::<u8>::new();
    for index in 0..(24 * 24) {
        let color = [(index % 100) as u8, 0, 0, 1 + (index / 100) as u8];
        rgba.extend_from_slice(&color);
    }
    let image = ico::IconImage::from_rgba_data(24, 24, rgba.to_vec());
    let entry = ico::IconDirEntry::encode_as_png(&image).unwrap();
    assert!(entry.is_png());
    assert_eq!(entry.bits_per_pixel(), 32);
    assert_eq!(entry.decode().unwrap().rgba_data(), rgba.as_slice());
}

#[test]
fn encode_png_without_alpha_channel() {
    // This image has 500 colors, but no alpha.  It should have 24 bpp when
    // encoded as a PNG.
    let mut rgba = Vec::<u8>::new();
    for index in 0..(24 * 24) {
        let color = [(index % 100) as u8, ((index / 100) % 5) as u8, 0, 0xff];
        rgba.extend_from_slice(&color);
    }
    let image = ico::IconImage::from_rgba_data(24, 24, rgba.to_vec());
    let entry = ico::IconDirEntry::encode_as_png(&image).unwrap();
    assert!(entry.is_png());
    assert_eq!(entry.bits_per_pixel(), 24);
    assert_eq!(entry.decode().unwrap().rgba_data(), rgba.as_slice());
}

//===========================================================================//
