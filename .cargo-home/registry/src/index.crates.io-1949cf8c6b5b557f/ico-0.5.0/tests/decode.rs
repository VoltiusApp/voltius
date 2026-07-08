extern crate ico;

use std::fs::File;
use std::path::PathBuf;

//===========================================================================//

#[test]
fn decode_ship_icons() {
    compare_ico_and_png("ship.ico", 4, "ship128x128.png");
}

#[test]
fn decode_wiki_icons() {
    compare_ico_and_png("wiki.ico", 0, "wiki48x48.png");
    compare_ico_and_png("wiki.ico", 1, "wiki32x32.png");
    compare_ico_and_png("wiki.ico", 2, "wiki16x16.png");
}

#[test]
fn decode_litexl_icons() {
    compare_ico_and_png("litexl.ico", 0, "litexl512x512.png");
    compare_ico_and_png("litexl.ico", 1, "litexl256x256.png");
    compare_ico_and_png("litexl.ico", 2, "litexl128x128.png");
    compare_ico_and_png("litexl.ico", 3, "litexl64x64.png");
    compare_ico_and_png("litexl.ico", 4, "litexl48x48.png");
    compare_ico_and_png("litexl.ico", 5, "litexl32x32.png");
    compare_ico_and_png("litexl.ico", 6, "litexl16x16.png");
}

//===========================================================================//

fn compare_ico_and_png(ico_path: &str, ico_index: usize, png_path: &str) {
    let ico_path = PathBuf::from("tests/images").join(ico_path);
    let png_path = PathBuf::from("tests/images").join(png_path);
    let ico_file = File::open(&ico_path).unwrap();
    let icon_dir = ico::IconDir::read(ico_file).unwrap();
    assert!(
        icon_dir.entries().len() > ico_index,
        "ICO file {:?} has only {} entries, but ico_index is {}",
        ico_path,
        icon_dir.entries().len(),
        ico_index
    );
    let ico_image = icon_dir.entries()[ico_index].decode().unwrap();
    let png_file = File::open(&png_path).unwrap();
    let png_image = ico::IconImage::read_png(png_file).unwrap();
    assert_eq!(
        ico_image.width(),
        png_image.width(),
        "ICO file {:?} entry {} has width of {}, \
         but PNG file {:?} has width of {}",
        ico_path,
        ico_index,
        ico_image.width(),
        png_path,
        png_image.width()
    );
    assert_eq!(
        ico_image.height(),
        png_image.height(),
        "ICO file {:?} entry {} has height of {}, \
         but PNG file {:?} has height of {}",
        ico_path,
        ico_index,
        ico_image.height(),
        png_path,
        png_image.height()
    );
    assert_eq!(
        ico_image.rgba_data(),
        png_image.rgba_data(),
        "ICO file {:?} entry {} and PNG file {:?} don't match",
        ico_path,
        ico_index,
        png_path
    );
}

//===========================================================================//
