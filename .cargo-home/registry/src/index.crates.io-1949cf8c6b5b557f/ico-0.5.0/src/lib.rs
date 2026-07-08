//! A library for encoding/decoding [ICO image
//! files](https://en.wikipedia.org/wiki/ICO_%28file_format%29).
//!
//! # Overview
//!
//! An ICO file (.ico) stores a collection of small images of different sizes
//! and color depths.  Individial images within the file can be encoded in
//! either BMP or PNG format.  ICO files are typically used for website
//! favicons and for Windows application icons.
//!
//! CUR files (.cur), which store Windows cursor images, use the same file
//! format as ICO files, except that each image also comes with (x, y)
//! *hotspot* coordinates that determines where on the image the user is
//! pointing.  This libary supports both file types.
//!
//! # Examples
//!
//! ## Reading an ICO file
//!
//! ```no_run
//! // Read an ICO file from disk:
//! let file = std::fs::File::open("path/to/file.ico").unwrap();
//! let icon_dir = ico::IconDir::read(file).unwrap();
//! // Print the size of each image in the ICO file:
//! for entry in icon_dir.entries() {
//!     println!("{}x{}", entry.width(), entry.height());
//! }
//! // Decode the first entry into an image:
//! let image = icon_dir.entries()[0].decode().unwrap();
//! // You can get raw RGBA pixel data to pass to another image library:
//! let rgba = image.rgba_data();
//! assert_eq!(rgba.len(), (4 * image.width() * image.height()) as usize);
//! // Alternatively, you can save the image as a PNG file:
//! let file = std::fs::File::create("icon.png").unwrap();
//! image.write_png(file).unwrap();
//! ```
//!
//! ## Creating an ICO file
//!
//! ```no_run
//! // Create a new, empty icon collection:
//! let mut icon_dir = ico::IconDir::new(ico::ResourceType::Icon);
//! // Read a PNG file from disk and add it to the collection:
//! let file = std::fs::File::open("path/to/image.png").unwrap();
//! let image = ico::IconImage::read_png(file).unwrap();
//! icon_dir.add_entry(ico::IconDirEntry::encode(&image).unwrap());
//! // Alternatively, you can create an IconImage from raw RGBA pixel data
//! // (e.g. from another image library):
//! let rgba = vec![std::u8::MAX; 4 * 16 * 16];
//! let image = ico::IconImage::from_rgba_data(16, 16, rgba);
//! icon_dir.add_entry(ico::IconDirEntry::encode(&image).unwrap());
//! // Finally, write the ICO file to disk:
//! let file = std::fs::File::create("favicon.ico").unwrap();
//! icon_dir.write(file).unwrap();
//! ```

#![warn(missing_docs)]

#[macro_use]
mod macros;

mod bmpdepth;
mod icondir;
mod image;
mod restype;

pub use crate::icondir::{IconDir, IconDirEntry};
pub use crate::image::IconImage;
pub use crate::restype::ResourceType;

//===========================================================================//
