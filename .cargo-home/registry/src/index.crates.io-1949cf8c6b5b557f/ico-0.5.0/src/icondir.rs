use crate::image::{IconImage, ImageStats};
use crate::restype::ResourceType;
use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};
use std::io::{self, Read, Seek, SeekFrom, Write};

//===========================================================================//

// The signature that all PNG files start with.
const PNG_SIGNATURE: &[u8] = &[0x89, b'P', b'N', b'G'];

//===========================================================================//

/// A collection of images; the contents of a single ICO or CUR file.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Deserialize, Serialize))]
pub struct IconDir {
    restype: ResourceType,
    entries: Vec<IconDirEntry>,
}

impl IconDir {
    /// Creates a new, empty collection of icons/cursors.
    pub fn new(resource_type: ResourceType) -> IconDir {
        IconDir { restype: resource_type, entries: Vec::new() }
    }

    /// Returns the type of resource stored in this collection, either icons or
    /// cursors.
    pub fn resource_type(&self) -> ResourceType {
        self.restype
    }

    /// Returns the entries in this collection.
    pub fn entries(&self) -> &[IconDirEntry] {
        &self.entries
    }

    /// Adds an entry to the collection.  Panics if `self.resource_type() !=
    /// entry.resource_type()`.
    pub fn add_entry(&mut self, entry: IconDirEntry) {
        if self.resource_type() != entry.resource_type() {
            panic!(
                "Can't add {:?} IconDirEntry to {:?} IconDir",
                entry.resource_type(),
                self.resource_type()
            );
        }
        self.entries.push(entry);
    }

    /// Reads an ICO or CUR file into memory.
    pub fn read<R: Read + Seek>(mut reader: R) -> io::Result<IconDir> {
        let reserved = reader.read_u16::<LittleEndian>()?;
        if reserved != 0 {
            invalid_data!(
                "Invalid reserved field value in ICONDIR \
                 (was {}, but must be 0)",
                reserved
            );
        }
        let restype = reader.read_u16::<LittleEndian>()?;
        let restype = match ResourceType::from_number(restype) {
            Some(restype) => restype,
            None => invalid_data!("Invalid resource type ({})", restype),
        };
        let num_entries = reader.read_u16::<LittleEndian>()? as usize;
        let mut entries = Vec::<IconDirEntry>::with_capacity(num_entries);
        let mut spans = Vec::<(u32, u32)>::with_capacity(num_entries);
        for _ in 0..num_entries {
            let width_byte = reader.read_u8()?;
            let height_byte = reader.read_u8()?;
            let num_colors = reader.read_u8()?;
            let reserved = reader.read_u8()?;
            if reserved != 0 {
                invalid_data!(
                    "Invalid reserved field value in ICONDIRENTRY \
                     (was {}, but must be 0)",
                    reserved
                );
            }
            let color_planes = reader.read_u16::<LittleEndian>()?;
            let bits_per_pixel = reader.read_u16::<LittleEndian>()?;
            let data_size = reader.read_u32::<LittleEndian>()?;
            let data_offset = reader.read_u32::<LittleEndian>()?;
            // The ICONDIRENTRY struct uses only one byte each for width and
            // height.  In older versions of Windows, a byte of zero indicated
            // a size of exactly 256, but since Windows Vista a byte of zero is
            // used for any size >= 256, with the actual size coming from the
            // BMP or PNG data.
            //
            // We initialize the IconDirEntry's width/height fields based on
            // these bytes, treating 0 as 256.  Later on we will replace these
            // values with the actual width/height from the image data;
            // however, in the event that the image data turns out to be
            // malformed, we will use these initial guesses for the image
            // metadata, so that the user can still parse the rest of the ICO
            // file and at least see what size this image was intended to be.
            let width = if width_byte == 0 { 256 } else { width_byte as u32 };
            let height =
                if height_byte == 0 { 256 } else { height_byte as u32 };
            spans.push((data_offset, data_size));
            let entry = IconDirEntry {
                restype,
                width,
                height,
                num_colors,
                color_planes,
                bits_per_pixel,
                data: Vec::new(),
            };
            entries.push(entry);
        }
        for (index, &(data_offset, data_size)) in spans.iter().enumerate() {
            reader.seek(SeekFrom::Start(data_offset as u64))?;
            let mut data = vec![0u8; data_size as usize];
            reader.read_exact(&mut data)?;
            entries[index].data = data;
        }
        // Update each IconDirEntry's width/height fields with the actual
        // width/height of its image data.
        for entry in entries.iter_mut() {
            // Ignore any errors here.  If this entry's image data is
            // malformed, defer errors until the user actually tries to decode
            // that image.
            if let Ok((width, height)) = entry.decode_size() {
                entry.width = width;
                entry.height = height;
                // TODO: Also update entry's bits-per-pixel.
            }
        }
        Ok(IconDir { restype, entries })
    }

    /// Writes an ICO or CUR file out to disk.
    pub fn write<W: Write>(&self, mut writer: W) -> io::Result<()> {
        if self.entries.len() > (u16::MAX as usize) {
            invalid_input!(
                "Too many entries in IconDir (was {}, but max is {})",
                self.entries.len(),
                u16::MAX
            );
        }
        writer.write_u16::<LittleEndian>(0)?; // reserved
        writer.write_u16::<LittleEndian>(self.restype.number())?;
        writer.write_u16::<LittleEndian>(self.entries.len() as u16)?;
        let mut data_offset = 6 + 16 * (self.entries.len() as u32);
        for entry in self.entries.iter() {
            // A width/height byte of zero indicates a size of 256 or more.
            let width = if entry.width > 255 { 0 } else { entry.width as u8 };
            writer.write_u8(width)?;
            let height =
                if entry.height > 255 { 0 } else { entry.height as u8 };
            writer.write_u8(height)?;
            writer.write_u8(entry.num_colors)?;
            writer.write_u8(0)?; // reserved
            writer.write_u16::<LittleEndian>(entry.color_planes)?;
            writer.write_u16::<LittleEndian>(entry.bits_per_pixel)?;
            let data_size = entry.data.len() as u32;
            writer.write_u32::<LittleEndian>(data_size)?;
            writer.write_u32::<LittleEndian>(data_offset)?;
            data_offset += data_size;
        }
        for entry in self.entries.iter() {
            writer.write_all(&entry.data)?;
        }
        Ok(())
    }
}

//===========================================================================//

/// One entry in an ICO or CUR file; a single icon or cursor.
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(Deserialize, Serialize))]
pub struct IconDirEntry {
    restype: ResourceType,
    width: u32,
    height: u32,
    num_colors: u8,
    color_planes: u16,
    bits_per_pixel: u16,
    data: Vec<u8>,
}

impl IconDirEntry {
    /// Returns the type of resource stored in this entry, either an icon or a
    /// cursor.
    pub fn resource_type(&self) -> ResourceType {
        self.restype
    }

    /// Returns the width of the image, in pixels.
    pub fn width(&self) -> u32 {
        self.width
    }

    /// Returns the height of the image, in pixels.
    pub fn height(&self) -> u32 {
        self.height
    }

    /// Returns the bits-per-pixel (color depth) of the image.  Returns zero if
    /// `self.resource_type() == ResourceType::Cursor` (since CUR files store
    /// hotspot coordinates in place of this field).
    pub fn bits_per_pixel(&self) -> u16 {
        if self.restype == ResourceType::Cursor {
            0
        } else {
            self.bits_per_pixel
        }
    }

    /// Returns the coordinates of the cursor hotspot (pixels right from the
    /// left edge of the image, and pixels down from the top edge), or `None`
    /// if `self.resource_type() != ResourceType::Cursor`.
    pub fn cursor_hotspot(&self) -> Option<(u16, u16)> {
        if self.restype == ResourceType::Cursor {
            Some((self.color_planes, self.bits_per_pixel))
        } else {
            None
        }
    }

    /// Returns true if the image is encoded as a PNG, or false if it is
    /// encoded as a BMP.
    pub fn is_png(&self) -> bool {
        self.data.starts_with(PNG_SIGNATURE)
    }

    /// Returns the raw, encoded image data.
    pub fn data(&self) -> &[u8] {
        &self.data
    }

    /// Decodes just enough of the raw image data to determine its size.
    pub(crate) fn decode_size(&mut self) -> io::Result<(u32, u32)> {
        if self.is_png() {
            let png_reader = IconImage::read_png_info(self.data.as_slice())?;
            Ok((png_reader.info().width, png_reader.info().height))
        } else {
            IconImage::read_bmp_size(&mut self.data.as_slice())
        }
    }

    /// Decodes this entry into an image.  Returns an error if the data is
    /// malformed or can't be decoded.
    pub fn decode(&self) -> io::Result<IconImage> {
        let mut image = if self.is_png() {
            IconImage::read_png(self.data.as_slice())?
        } else {
            IconImage::read_bmp(self.data.as_slice())?
        };
        if image.width() != self.width || image.height() != self.height {
            invalid_data!(
                "Encoded image has wrong dimensions \
                 (was {}x{}, but should be {}x{})",
                image.width(),
                image.height(),
                self.width,
                self.height
            );
        }
        image.set_cursor_hotspot(self.cursor_hotspot());
        Ok(image)
    }

    /// Encodes an image in a new entry.  The encoding method is chosen
    /// automatically based on the image.  Returns an error if the encoding
    /// fails.
    pub fn encode(image: &IconImage) -> io::Result<IconDirEntry> {
        let stats = image.compute_stats();
        // Very rough heuristic: Use PNG only for images with complicated alpha
        // or for large images, which are cases where PNG's better compression
        // is a big savings.  Otherwise, prefer BMP for its better
        // backwards-compatibility with older ICO consumers.
        let use_png = stats.has_nonbinary_alpha
            || image.width() * image.height() > 64 * 64;
        if use_png {
            IconDirEntry::encode_as_png_internal(image, &stats)
        } else {
            IconDirEntry::encode_as_bmp_internal(image, &stats)
        }
    }

    /// Encodes an image as a BMP in a new entry.  The color depth is
    /// determined automatically based on the image.  Returns an error if the
    /// encoding fails.
    pub fn encode_as_bmp(image: &IconImage) -> io::Result<IconDirEntry> {
        IconDirEntry::encode_as_bmp_internal(image, &image.compute_stats())
    }

    fn encode_as_bmp_internal(
        image: &IconImage,
        stats: &ImageStats,
    ) -> io::Result<IconDirEntry> {
        let (num_colors, bits_per_pixel, data) =
            image.write_bmp_internal(stats)?;
        let (color_planes, bits_per_pixel) =
            image.cursor_hotspot().unwrap_or((1, bits_per_pixel));
        let restype = if image.cursor_hotspot().is_some() {
            ResourceType::Cursor
        } else {
            ResourceType::Icon
        };
        let entry = IconDirEntry {
            restype,
            width: image.width(),
            height: image.height(),
            num_colors,
            color_planes,
            bits_per_pixel,
            data,
        };
        Ok(entry)
    }

    /// Encodes an image as a PNG in a new entry.  The color depth is
    /// determined automatically based on the image.  Returns an error if the
    /// encoding fails.
    pub fn encode_as_png(image: &IconImage) -> io::Result<IconDirEntry> {
        IconDirEntry::encode_as_png_internal(image, &image.compute_stats())
    }

    fn encode_as_png_internal(
        image: &IconImage,
        stats: &ImageStats,
    ) -> io::Result<IconDirEntry> {
        let mut data = Vec::new();
        let bits_per_pixel = image.write_png_internal(stats, &mut data)?;
        let (color_planes, bits_per_pixel) =
            image.cursor_hotspot().unwrap_or((0, bits_per_pixel));
        let restype = if image.cursor_hotspot().is_some() {
            ResourceType::Cursor
        } else {
            ResourceType::Icon
        };
        let entry = IconDirEntry {
            restype,
            width: image.width(),
            height: image.height(),
            num_colors: 0,
            color_planes,
            bits_per_pixel,
            data,
        };
        Ok(entry)
    }
}

//===========================================================================//

#[cfg(test)]
mod tests {
    use super::{IconDir, IconDirEntry, IconImage, ResourceType};
    use std::io::Cursor;

    #[test]
    fn read_empty_icon_set() {
        let input = b"\x00\x00\x01\x00\x00\x00";
        let icondir = IconDir::read(Cursor::new(input)).unwrap();
        assert_eq!(icondir.resource_type(), ResourceType::Icon);
        assert_eq!(icondir.entries().len(), 0);
    }

    #[test]
    fn read_empty_cursor_set() {
        let input = b"\x00\x00\x02\x00\x00\x00";
        let icondir = IconDir::read(Cursor::new(input)).unwrap();
        assert_eq!(icondir.resource_type(), ResourceType::Cursor);
        assert_eq!(icondir.entries().len(), 0);
    }

    #[test]
    fn write_empty_icon_set() {
        let icondir = IconDir::new(ResourceType::Icon);
        let mut output = Vec::<u8>::new();
        icondir.write(&mut output).unwrap();
        let expected: &[u8] = b"\x00\x00\x01\x00\x00\x00";
        assert_eq!(output.as_slice(), expected);
    }

    #[test]
    fn write_empty_cursor_set() {
        let icondir = IconDir::new(ResourceType::Cursor);
        let mut output = Vec::<u8>::new();
        icondir.write(&mut output).unwrap();
        let expected: &[u8] = b"\x00\x00\x02\x00\x00\x00";
        assert_eq!(output.as_slice(), expected);
    }

    #[test]
    fn read_bmp_1bpp_icon() {
        let input: &[u8] = b"\
            \x00\x00\x01\x00\x01\x00\
            \
            \x02\x02\x02\x00\x01\x00\x01\x00\
            \x40\x00\x00\x00\x16\x00\x00\x00\
            \
            \x28\x00\x00\x00\x02\x00\x00\x00\x04\x00\x00\x00\
            \x01\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\
            \x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\
            \x00\x00\x00\x00\
            \
            \x55\x00\x55\x00\xff\xff\xff\x00\
            \
            \xc0\x00\x00\x00\
            \x40\x00\x00\x00\
            \
            \x40\x00\x00\x00\
            \x00\x00\x00\x00";
        let icondir = IconDir::read(Cursor::new(input)).unwrap();
        assert_eq!(icondir.resource_type(), ResourceType::Icon);
        assert_eq!(icondir.entries().len(), 1);
        let entry = &icondir.entries()[0];
        assert_eq!(entry.width(), 2);
        assert_eq!(entry.height(), 2);
        assert!(!entry.is_png());
        let image = entry.decode().unwrap();
        assert_eq!(image.width(), 2);
        assert_eq!(image.height(), 2);
        let rgba: &[u8] = b"\
            \x55\x00\x55\xff\xff\xff\xff\xff\
            \xff\xff\xff\xff\xff\xff\xff\x00";
        assert_eq!(image.rgba_data(), rgba);
    }

    #[test]
    fn read_bmp_4bpp_icon() {
        let input: &[u8] = b"\
            \x00\x00\x01\x00\x01\x00\
            \
            \x05\x03\x10\x00\x01\x00\x04\x00\
            \x80\x00\x00\x00\x16\x00\x00\x00\
            \
            \x28\x00\x00\x00\x05\x00\x00\x00\x06\x00\x00\x00\
            \x01\x00\x04\x00\x00\x00\x00\x00\x00\x00\x00\x00\
            \x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\
            \x00\x00\x00\x00\
            \
            \x00\x00\x00\x00\x00\x00\x00\x00\
            \x00\x00\x7f\x00\x00\x00\xff\x00\
            \x00\x7f\x00\x00\x00\xff\x00\x00\
            \x00\x7f\x7f\x00\x00\xff\xff\x00\
            \x7f\x00\x00\x00\xff\x00\x00\x00\
            \x7f\x00\x7f\x00\xff\x00\xff\x00\
            \x7f\x7f\x00\x00\xff\xff\x00\x00\
            \x7f\x7f\x7f\x00\xff\xff\xff\x00\
            \
            \x0f\x35\x00\x00\
            \xf3\x59\x10\x00\
            \x05\x91\x00\x00\
            \
            \x88\x00\x00\x00\
            \x00\x00\x00\x00\
            \x88\x00\x00\x00";
        let icondir = IconDir::read(Cursor::new(input)).unwrap();
        assert_eq!(icondir.resource_type(), ResourceType::Icon);
        assert_eq!(icondir.entries().len(), 1);
        let entry = &icondir.entries()[0];
        assert_eq!(entry.width(), 5);
        assert_eq!(entry.height(), 3);
        assert!(!entry.is_png());
        let image = entry.decode().unwrap();
        assert_eq!(image.width(), 5);
        assert_eq!(image.height(), 3);
        let rgba: &[u8] = b"\
            \x00\x00\x00\x00\x00\xff\x00\xff\x00\x00\xff\xff\
            \x00\x00\x00\xff\x00\x00\x00\x00\
            \xff\xff\xff\xff\xff\x00\x00\xff\x00\xff\x00\xff\
            \x00\x00\xff\xff\x00\x00\x00\xff\
            \x00\x00\x00\x00\xff\xff\xff\xff\xff\x00\x00\xff\
            \x00\xff\x00\xff\x00\x00\x00\x00";
        assert_eq!(image.rgba_data(), rgba);
    }

    #[test]
    fn read_png_grayscale_icon() {
        let input: &[u8] = b"\
            \x00\x00\x01\x00\x01\x00\
            \
            \x02\x02\x00\x00\x00\x00\x00\x00\
            \x47\x00\x00\x00\x16\x00\x00\x00\
            \
            \x89\x50\x4e\x47\x0d\x0a\x1a\x0a\x00\x00\x00\x0d\x49\x48\x44\x52\
            \x00\x00\x00\x02\x00\x00\x00\x02\x08\x00\x00\x00\x00\x57\xdd\x52\
            \xf8\x00\x00\x00\x0e\x49\x44\x41\x54\x78\x9c\x63\xb4\x77\x60\xdc\
            \xef\x00\x00\x04\x08\x01\x81\x86\x2e\xc9\x8d\x00\x00\x00\x00\x49\
            \x45\x4e\x44\xae\x42\x60\x82";
        let icondir = IconDir::read(Cursor::new(input)).unwrap();
        assert_eq!(icondir.resource_type(), ResourceType::Icon);
        assert_eq!(icondir.entries().len(), 1);
        let entry = &icondir.entries()[0];
        assert_eq!(entry.width(), 2);
        assert_eq!(entry.height(), 2);
        assert!(entry.is_png());
        let image = entry.decode().unwrap();
        assert_eq!(image.width(), 2);
        assert_eq!(image.height(), 2);
        let rgba: &[u8] = b"\
            \x3f\x3f\x3f\xff\x7f\x7f\x7f\xff\
            \xbf\xbf\xbf\xff\xff\xff\xff\xff";
        assert_eq!(image.rgba_data(), rgba);
    }

    #[test]
    fn image_data_round_trip() {
        // Create an image:
        let width = 11;
        let height = 13;
        let mut rgba = Vec::new();
        for index in 0..(width * height) {
            rgba.push(if index % 2 == 0 { 0 } else { 255 });
            rgba.push(if index % 3 == 0 { 0 } else { 255 });
            rgba.push(if index % 5 == 0 { 0 } else { 255 });
            rgba.push(if index % 7 == 0 { 128 } else { 255 });
        }
        let image = IconImage::from_rgba_data(width, height, rgba.clone());
        // Write that image into an ICO file:
        let mut icondir = IconDir::new(ResourceType::Icon);
        icondir.add_entry(IconDirEntry::encode(&image).unwrap());
        let mut file = Vec::<u8>::new();
        icondir.write(&mut file).unwrap();
        // Read the ICO file back in and make sure the image is the same:
        let icondir = IconDir::read(Cursor::new(&file)).unwrap();
        assert_eq!(icondir.entries().len(), 1);
        let image = icondir.entries()[0].decode().unwrap();
        assert_eq!(image.width(), width);
        assert_eq!(image.height(), height);
        assert_eq!(image.rgba_data(), rgba.as_slice());
    }
}

//===========================================================================//
