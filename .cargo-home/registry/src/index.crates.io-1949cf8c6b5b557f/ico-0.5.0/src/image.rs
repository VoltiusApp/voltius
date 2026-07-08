use crate::bmpdepth::BmpDepth;
use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use std::collections::{BTreeSet, HashMap};
use std::io::{self, Read, Write};

//===========================================================================//

// The size of a BITMAPINFOHEADER struct, in bytes.
const BMP_HEADER_LEN: u32 = 40;

// Size limits for images in an ICO file:
const MIN_WIDTH: u32 = 1;
const MIN_HEIGHT: u32 = 1;

//===========================================================================//

/// A decoded image.
#[derive(Clone)]
pub struct IconImage {
    width: u32,
    height: u32,
    hotspot: Option<(u16, u16)>,
    rgba_data: Vec<u8>,
}

impl IconImage {
    /// Creates a new image with the given dimensions. The `width` and `height`
    /// must be nonzero. The image data is initialized to zeros. Panics if the
    /// dimensions are out of range.
    pub fn new(width: u32, height: u32) -> IconImage {
        if width < MIN_WIDTH {
            panic!(
                "Invalid width (was {}, but must be at least {})",
                width, MIN_WIDTH
            );
        }
        if height < MIN_HEIGHT {
            panic!(
                "Invalid height (was {}, but must be at least {})",
                height, MIN_HEIGHT
            );
        }

        IconImage {
            width,
            height,
            hotspot: None,
            rgba_data: vec![0u8; (width as usize) * (height as usize) * 4],
        }
    }

    /// Creates a new image with the given dimensions and RGBA data.  The
    /// `width` and `height` must be nonzero, and `rgba_data` must have `4 *
    /// width * height` bytes and be in row-major order from top to bottom.
    /// Panics if the dimensions are out of range or if `rgba_data` is the
    /// wrong length.
    pub fn from_rgba_data(
        width: u32,
        height: u32,
        rgba_data: Vec<u8>,
    ) -> IconImage {
        if width < MIN_WIDTH {
            panic!(
                "Invalid width (was {}, but must be at least {})",
                width, MIN_WIDTH
            );
        }
        if height < MIN_HEIGHT {
            panic!(
                "Invalid height (was {}, but must be at least {})",
                height, MIN_HEIGHT
            );
        }
        let expected_data_len = (width as u64) * (height as u64) * 4;
        if (rgba_data.len() as u64) != expected_data_len {
            panic!(
                "Invalid data length (was {}, but must be {} for {}x{} image)",
                rgba_data.len(),
                expected_data_len,
                width,
                height
            );
        }
        IconImage { width, height, hotspot: None, rgba_data }
    }

    pub(crate) fn read_png_info<R: Read>(
        reader: R,
    ) -> io::Result<png::Reader<R>> {
        let decoder = png::Decoder::new(reader);
        let png_reader = match decoder.read_info() {
            Ok(png_reader) => png_reader,
            Err(error) => invalid_data!("Malformed PNG data: {}", error),
        };
        IconImage::validate_png_info(png_reader.info())?;
        Ok(png_reader)
    }

    fn validate_png_info(info: &png::Info) -> io::Result<()> {
        if info.width < MIN_WIDTH {
            invalid_data!(
                "Invalid PNG width (was {}, but must be at least {}",
                info.width,
                MIN_WIDTH
            );
        }
        if info.height < MIN_HEIGHT {
            invalid_data!(
                "Invalid PNG height (was {}, but must be at least {})",
                info.height,
                MIN_HEIGHT
            );
        }
        if info.bit_depth != png::BitDepth::Eight {
            // TODO: Support other bit depths.
            invalid_data!("Unsupported PNG bit depth: {:?}", info.bit_depth);
        }
        Ok(())
    }

    /// Decodes an image from a PNG file.  Returns an error if the PNG data is
    /// malformed or can't be decoded.
    pub fn read_png<R: Read>(reader: R) -> io::Result<IconImage> {
        let mut png_reader = IconImage::read_png_info(reader)?;
        let mut buffer = vec![0u8; png_reader.output_buffer_size()];
        match png_reader.next_frame(&mut buffer) {
            Ok(_) => {}
            Err(error) => invalid_data!("Malformed PNG data: {}", error),
        }
        let rgba_data = match png_reader.info().color_type {
            png::ColorType::Rgba => buffer,
            png::ColorType::Rgb => {
                let num_pixels = buffer.len() / 3;
                let mut rgba = Vec::with_capacity(num_pixels * 4);
                for i in 0..num_pixels {
                    rgba.extend_from_slice(&buffer[(3 * i)..][..3]);
                    rgba.push(u8::MAX);
                }
                rgba
            }
            png::ColorType::GrayscaleAlpha => {
                let num_pixels = buffer.len() / 2;
                let mut rgba = Vec::with_capacity(num_pixels * 4);
                for i in 0..num_pixels {
                    let gray = buffer[2 * i];
                    let alpha = buffer[2 * i + 1];
                    rgba.push(gray);
                    rgba.push(gray);
                    rgba.push(gray);
                    rgba.push(alpha);
                }
                rgba
            }
            png::ColorType::Grayscale => {
                let mut rgba = Vec::with_capacity(buffer.len() * 4);
                for value in buffer.into_iter() {
                    rgba.push(value);
                    rgba.push(value);
                    rgba.push(value);
                    rgba.push(u8::MAX);
                }
                rgba
            }
            png::ColorType::Indexed => {
                // TODO: Implement ColorType::Indexed conversion
                invalid_data!(
                    "Unsupported PNG color type: {:?}",
                    png_reader.info().color_type
                );
            }
        };
        Ok(IconImage::from_rgba_data(
            png_reader.info().width,
            png_reader.info().height,
            rgba_data,
        ))
    }

    /// Encodes the image as a PNG file.
    pub fn write_png<W: Write>(&self, writer: W) -> io::Result<()> {
        let _bits_per_pixel =
            self.write_png_internal(&self.compute_stats(), writer)?;
        Ok(())
    }

    /// Encodes the image as a PNG file and returns the bits-per-pixel.
    pub(crate) fn write_png_internal<W: Write>(
        &self,
        stats: &ImageStats,
        writer: W,
    ) -> io::Result<u16> {
        match self.write_png_internal_enc(stats, writer) {
            Ok(bits_per_pixel) => Ok(bits_per_pixel),
            Err(png::EncodingError::IoError(error)) => Err(error),
            Err(png::EncodingError::Format(error)) => {
                invalid_input!("PNG format error: {}", error);
            }
            Err(png::EncodingError::LimitsExceeded) => {
                invalid_input!("PNG limits exceeded");
            }
            Err(png::EncodingError::Parameter(error)) => {
                invalid_input!("PNG parameter error: {}", error);
            }
        }
    }

    /// Encodes the image as a PNG file and returns the bits-per-pixel (or the
    /// `png::EncodingError`).
    fn write_png_internal_enc<W: Write>(
        &self,
        stats: &ImageStats,
        writer: W,
    ) -> Result<u16, png::EncodingError> {
        let mut encoder = png::Encoder::new(writer, self.width, self.height);
        // TODO: Detect if we can use grayscale.
        encoder.set_depth(png::BitDepth::Eight);
        if stats.has_alpha {
            encoder.set_color(png::ColorType::Rgba);
        } else {
            encoder.set_color(png::ColorType::Rgb);
        }
        let mut writer = encoder.write_header()?;
        if stats.has_alpha {
            writer.write_image_data(&self.rgba_data)?;
            Ok(32)
        } else {
            debug_assert_eq!(self.rgba_data.len() % 4, 0);
            let mut rgb_data =
                Vec::<u8>::with_capacity((self.rgba_data.len() / 4) * 3);
            let mut start = 0;
            while start < self.rgba_data.len() {
                rgb_data.push(self.rgba_data[start]);
                rgb_data.push(self.rgba_data[start + 1]);
                rgb_data.push(self.rgba_data[start + 2]);
                start += 4;
            }
            writer.write_image_data(&rgb_data)?;
            Ok(24)
        }
    }

    pub(crate) fn read_bmp_size<R: Read>(
        reader: &mut R,
    ) -> io::Result<(u32, u32)> {
        let data_size = reader.read_u32::<LittleEndian>()?;
        if data_size != BMP_HEADER_LEN {
            invalid_data!(
                "Invalid BMP header size (was {}, must be {})",
                data_size,
                BMP_HEADER_LEN
            );
        }
        let width = reader.read_i32::<LittleEndian>()?;
        if width < (MIN_WIDTH as i32) {
            invalid_data!(
                "Invalid BMP width (was {}, but must be at least {})",
                width,
                MIN_WIDTH
            );
        }
        let width = width as u32;
        let height = reader.read_i32::<LittleEndian>()?;
        if height % 2 != 0 {
            // The height is stored doubled, counting the rows of both the
            // color data and the alpha mask, so it should be divisible by 2.
            invalid_data!(
                "Invalid height field in BMP header \
                 (was {}, but must be divisible by 2)",
                height
            );
        }
        let height = height / 2;
        if height < (MIN_HEIGHT as i32) {
            invalid_data!(
                "Invalid BMP height (was {}, but must be at least {})",
                height,
                MIN_HEIGHT
            );
        }
        let height = height as u32;
        Ok((width, height))
    }

    pub(crate) fn read_bmp<R: Read>(mut reader: R) -> io::Result<IconImage> {
        // Read the BITMAPINFOHEADER struct:
        let (width, height) = IconImage::read_bmp_size(&mut reader)?;
        let _planes = reader.read_u16::<LittleEndian>()?;
        let bits_per_pixel = reader.read_u16::<LittleEndian>()?;
        let _compression = reader.read_u32::<LittleEndian>()?;
        let _image_size = reader.read_u32::<LittleEndian>()?;
        let _horz_ppm = reader.read_i32::<LittleEndian>()?;
        let _vert_ppm = reader.read_i32::<LittleEndian>()?;
        let _colors_used = reader.read_u32::<LittleEndian>()?;
        let _colors_important = reader.read_u32::<LittleEndian>()?;

        // Determine the size of the color table:
        let depth = match BmpDepth::from_bits_per_pixel(bits_per_pixel) {
            Some(depth) => depth,
            None => {
                invalid_data!(
                    "Unsupported BMP bits-per-pixel ({})",
                    bits_per_pixel
                );
            }
        };
        let num_colors = depth.num_colors();

        // Read in the color table:
        let mut color_table = Vec::<(u8, u8, u8)>::with_capacity(num_colors);
        for _ in 0..num_colors {
            let blue = reader.read_u8()?;
            let green = reader.read_u8()?;
            let red = reader.read_u8()?;
            let _reserved = reader.read_u8()?;
            color_table.push((red, green, blue));
        }

        // Read in the color data, which is stored row by row, starting from
        // the *bottom* row:

        let num_pixels = match width.checked_mul(height) {
            Some(num) => num as usize,
            None => invalid_data!("Width * Height is too large"),
        };
        let mut rgba = vec![u8::MAX; num_pixels * 4];
        let row_data_size = (width * (bits_per_pixel as u32)).div_ceil(8);
        let row_padding_size = row_data_size.div_ceil(4) * 4 - row_data_size;
        let mut row_padding = vec![0; row_padding_size as usize];
        for row in 0..height {
            let mut start = (4 * (height - row - 1) * width) as usize;
            match depth {
                BmpDepth::One => {
                    let mut col = 0;
                    for _ in 0..row_data_size {
                        let byte = reader.read_u8()?;
                        for bit in 0..8 {
                            let index = (byte >> (7 - bit)) & 0x1;
                            let (red, green, blue) =
                                color_table[index as usize];
                            rgba[start] = red;
                            rgba[start + 1] = green;
                            rgba[start + 2] = blue;
                            col += 1;
                            if col == width {
                                break;
                            }
                            start += 4;
                        }
                    }
                }
                BmpDepth::Four => {
                    let mut col = 0;
                    for _ in 0..row_data_size {
                        let byte = reader.read_u8()?;
                        for nibble in 0..2 {
                            let index = (byte >> (4 * (1 - nibble))) & 0xf;
                            let (red, green, blue) =
                                color_table[index as usize];
                            rgba[start] = red;
                            rgba[start + 1] = green;
                            rgba[start + 2] = blue;
                            col += 1;
                            if col == width {
                                break;
                            }
                            start += 4;
                        }
                    }
                }
                BmpDepth::Eight => {
                    for _ in 0..width {
                        let index = reader.read_u8()?;
                        let (red, green, blue) = color_table[index as usize];
                        rgba[start] = red;
                        rgba[start + 1] = green;
                        rgba[start + 2] = blue;
                        start += 4;
                    }
                }
                BmpDepth::Sixteen => {
                    for _ in 0..width {
                        let color = reader.read_u16::<LittleEndian>()?;
                        let red = (color >> 10) & 0x1f;
                        let green = (color >> 5) & 0x1f;
                        let blue = color & 0x1f;
                        rgba[start] = ((red * 255 + 15) / 31) as u8;
                        rgba[start + 1] = ((green * 255 + 15) / 31) as u8;
                        rgba[start + 2] = ((blue * 255 + 15) / 31) as u8;
                        start += 4;
                    }
                }
                BmpDepth::TwentyFour => {
                    for _ in 0..width {
                        let blue = reader.read_u8()?;
                        let green = reader.read_u8()?;
                        let red = reader.read_u8()?;
                        rgba[start] = red;
                        rgba[start + 1] = green;
                        rgba[start + 2] = blue;
                        start += 4;
                    }
                }
                BmpDepth::ThirtyTwo => {
                    for _ in 0..width {
                        let blue = reader.read_u8()?;
                        let green = reader.read_u8()?;
                        let red = reader.read_u8()?;
                        let alpha = reader.read_u8()?;
                        rgba[start] = red;
                        rgba[start + 1] = green;
                        rgba[start + 2] = blue;
                        rgba[start + 3] = alpha;
                        start += 4;
                    }
                }
            }
            reader.read_exact(&mut row_padding)?;
        }

        // Read in the alpha mask (1 bit per pixel), which again is stored row
        // by row, starting from the *bottom* row, with each row padded to a
        // multiple of four bytes:
        if depth != BmpDepth::ThirtyTwo {
            let row_mask_size = width.div_ceil(8);
            let row_padding_size =
                row_mask_size.div_ceil(4) * 4 - row_mask_size;
            let mut row_padding = vec![0; row_padding_size as usize];
            for row in 0..height {
                let mut start = (4 * (height - row - 1) * width) as usize;
                let mut col = 0;
                for _ in 0..row_mask_size {
                    let byte = reader.read_u8()?;
                    for bit in 0..8 {
                        if ((byte >> (7 - bit)) & 0x1) == 1 {
                            rgba[start + 3] = 0;
                        }
                        col += 1;
                        if col == width {
                            break;
                        }
                        start += 4;
                    }
                }
                reader.read_exact(&mut row_padding)?;
            }
        }

        Ok(IconImage::from_rgba_data(width, height, rgba))
    }

    /// Encodes the image as a BMP and returns the size of the color table, the
    /// bits-per-pixel, and the encoded data.
    pub(crate) fn write_bmp_internal(
        &self,
        stats: &ImageStats,
    ) -> io::Result<(u8, u16, Vec<u8>)> {
        // Determine the most appropriate color depth for encoding this image:
        let width = self.width();
        let height = self.height();
        let rgba = self.rgba_data();
        let (depth, colors) = if stats.has_nonbinary_alpha {
            // Only 32 bpp can support alpha values between 0 and 255, even if
            // the image has a small number of colors, because the BMP color
            // table can't contain alpha values.
            (BmpDepth::ThirtyTwo, Vec::new())
        } else if let Some(ref colors) = stats.colors {
            if colors.len() <= 2 {
                (BmpDepth::One, colors.iter().cloned().collect())
            } else if colors.len() <= 16 {
                (BmpDepth::Four, colors.iter().cloned().collect())
            } else {
                debug_assert!(colors.len() <= 256);
                if width * height < 512 {
                    // At fewer than 512 pixels, it's more efficient to encode
                    // at 24 bpp, so we can omit the 256-entry color table.
                    (BmpDepth::TwentyFour, Vec::new())
                } else {
                    (BmpDepth::Eight, colors.iter().cloned().collect())
                }
            }
        } else {
            (BmpDepth::TwentyFour, Vec::new())
        };
        let bits_per_pixel = depth.bits_per_pixel();
        let num_colors = depth.num_colors();

        // Determine the size of the encoded data:
        let rgb_row_data_size =
            ((width as usize) * (bits_per_pixel as usize)).div_ceil(8);
        let rgb_row_size = rgb_row_data_size.div_ceil(4) * 4;
        let rgb_row_padding = vec![0u8; rgb_row_size - rgb_row_data_size];
        let mask_row_data_size = (width as usize).div_ceil(8);
        let mask_row_size = mask_row_data_size.div_ceil(4) * 4;
        let mask_row_padding = vec![0u8; mask_row_size - mask_row_data_size];
        let data_size = BMP_HEADER_LEN as usize
            + 4 * num_colors
            + height as usize * (rgb_row_size + mask_row_size);
        let mut data = Vec::<u8>::with_capacity(data_size);

        // Write the BITMAPINFOHEADER struct:
        data.write_u32::<LittleEndian>(BMP_HEADER_LEN)?;
        data.write_i32::<LittleEndian>(width as i32)?;
        data.write_i32::<LittleEndian>(2 * height as i32)?;
        data.write_u16::<LittleEndian>(1)?; // planes
        data.write_u16::<LittleEndian>(bits_per_pixel)?;
        data.write_u32::<LittleEndian>(0)?; // compression
        data.write_u32::<LittleEndian>(0)?; // image size
        data.write_i32::<LittleEndian>(0)?; // horz ppm
        data.write_i32::<LittleEndian>(0)?; // vert ppm
        data.write_u32::<LittleEndian>(0)?; // colors used
        data.write_u32::<LittleEndian>(0)?; // colors important
        debug_assert_eq!(data.len(), BMP_HEADER_LEN as usize);

        // Write the color table:
        let mut color_map = HashMap::<(u8, u8, u8), u8>::new();
        for (index, &(red, green, blue)) in colors.iter().enumerate() {
            color_map.insert((red, green, blue), index as u8);
            data.write_u8(blue)?;
            data.write_u8(green)?;
            data.write_u8(red)?;
            data.write_u8(0)?;
        }
        debug_assert!(color_map.len() <= num_colors);
        for _ in 0..(num_colors - color_map.len()) {
            data.write_u32::<LittleEndian>(0)?;
        }

        // Write the color data:
        for row in 0..height {
            let mut start = (4 * (height - row - 1) * width) as usize;
            match depth {
                BmpDepth::One => {
                    let mut col = 0;
                    for _ in 0..rgb_row_data_size {
                        let mut byte = 0;
                        for bit in 0..8 {
                            let red = rgba[start];
                            let green = rgba[start + 1];
                            let blue = rgba[start + 2];
                            let color = (red, green, blue);
                            let index = *color_map.get(&color).unwrap();
                            debug_assert!(index <= 0x1);
                            byte |= index << (7 - bit);
                            col += 1;
                            if col == width {
                                break;
                            }
                            start += 4;
                        }
                        data.write_u8(byte)?;
                    }
                }
                BmpDepth::Four => {
                    let mut col = 0;
                    for _ in 0..rgb_row_data_size {
                        let mut byte = 0;
                        for nibble in 0..2 {
                            let red = rgba[start];
                            let green = rgba[start + 1];
                            let blue = rgba[start + 2];
                            let color = (red, green, blue);
                            let index = *color_map.get(&color).unwrap();
                            debug_assert!(index <= 0xf);
                            byte |= index << (4 * (1 - nibble));
                            col += 1;
                            if col == width {
                                break;
                            }
                            start += 4;
                        }
                        data.write_u8(byte)?;
                    }
                }
                BmpDepth::Eight => {
                    debug_assert_eq!(width as usize, rgb_row_data_size);
                    for _ in 0..width {
                        let red = rgba[start];
                        let green = rgba[start + 1];
                        let blue = rgba[start + 2];
                        let color = (red, green, blue);
                        data.write_u8(*color_map.get(&color).unwrap())?;
                        start += 4;
                    }
                }
                BmpDepth::Sixteen => {
                    // We never choose BmpDepth::Sixteen above, so this should
                    // be unreachable.
                    invalid_input!("Encoding 16-bpp BMPs is not implemented");
                }
                BmpDepth::TwentyFour => {
                    debug_assert_eq!(3 * width as usize, rgb_row_data_size);
                    for _ in 0..width {
                        let red = rgba[start];
                        let green = rgba[start + 1];
                        let blue = rgba[start + 2];
                        data.write_u8(blue)?;
                        data.write_u8(green)?;
                        data.write_u8(red)?;
                        start += 4;
                    }
                }
                BmpDepth::ThirtyTwo => {
                    debug_assert_eq!(4 * width as usize, rgb_row_data_size);
                    for _ in 0..width {
                        let red = rgba[start];
                        let green = rgba[start + 1];
                        let blue = rgba[start + 2];
                        let alpha = rgba[start + 3];
                        data.write_u8(blue)?;
                        data.write_u8(green)?;
                        data.write_u8(red)?;
                        data.write_u8(alpha)?;
                        start += 4;
                    }
                }
            }
            data.write_all(&rgb_row_padding)?;
        }

        // Write the mask data:
        for row in 0..height {
            let mut start = (4 * (height - row - 1) * width) as usize;
            let mut col = 0;
            for _ in 0..mask_row_data_size {
                let mut byte = 0;
                for bit in 0..8 {
                    if rgba[start + 3] == 0 {
                        byte |= 1 << (7 - bit);
                    }
                    col += 1;
                    if col == width {
                        break;
                    }
                    start += 4;
                }
                data.write_u8(byte)?;
            }
            data.write_all(&mask_row_padding)?;
        }

        debug_assert_eq!(data.len(), data_size);
        Ok((num_colors as u8, bits_per_pixel, data))
    }

    /// Returns the width of the image, in pixels.
    pub fn width(&self) -> u32 {
        self.width
    }

    /// Returns the height of the image, in pixels.
    pub fn height(&self) -> u32 {
        self.height
    }

    /// Returns the coordinates of the cursor hotspot (pixels right from the
    /// left edge of the image, and pixels down from the top edge), or `None`
    /// if this image is an icon rather than a cursor.
    pub fn cursor_hotspot(&self) -> Option<(u16, u16)> {
        self.hotspot
    }

    /// Sets or clears the cursor hotspot coordinates.
    pub fn set_cursor_hotspot(&mut self, hotspot: Option<(u16, u16)>) {
        self.hotspot = hotspot;
    }

    /// Returns a slice to the RGBA data for this image, in row-major order
    /// from top to bottom.
    pub fn rgba_data(&self) -> &[u8] {
        &self.rgba_data
    }

    /// Returns a mutable slice to the RGBA data for this image, in row-major
    /// order from top to bottom.
    pub fn rgba_data_mut(&mut self) -> &mut [u8] {
        &mut self.rgba_data
    }

    /// Consumes this `IconImage` and returns the raw RGBA data in row-major
    /// order as an owned `Vec<u8>`
    pub fn into_rgba_data(self) -> Vec<u8> {
        self.rgba_data
    }

    pub(crate) fn compute_stats(&self) -> ImageStats {
        let mut colors = BTreeSet::<(u8, u8, u8)>::new();
        let mut has_alpha = false;
        let mut has_nonbinary_alpha = false;
        let mut start = 0;
        while start < self.rgba_data.len() {
            let alpha = self.rgba_data[start + 3];
            if alpha != u8::MAX {
                has_alpha = true;
                if alpha != 0 {
                    has_nonbinary_alpha = true;
                }
            }
            if colors.len() <= 256 {
                let red = self.rgba_data[start];
                let green = self.rgba_data[start + 1];
                let blue = self.rgba_data[start + 2];
                colors.insert((red, green, blue));
            }
            start += 4;
        }
        ImageStats {
            has_alpha,
            has_nonbinary_alpha,
            colors: if colors.len() <= 256 { Some(colors) } else { None },
        }
    }
}

//===========================================================================//

pub(crate) struct ImageStats {
    /// True if the image uses transparency.
    pub(crate) has_alpha: bool,
    /// True if the image has alpha values between 0 and the maximum exclusive.
    pub(crate) has_nonbinary_alpha: bool,
    /// A table of at most 256 colors, or `None` if the image has more than 256
    /// colors.
    pub(crate) colors: Option<BTreeSet<(u8, u8, u8)>>,
}

//===========================================================================//
