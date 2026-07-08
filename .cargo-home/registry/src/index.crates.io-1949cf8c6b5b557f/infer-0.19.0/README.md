# infer

![Build Status](https://github.com/bojand/infer/workflows/build/badge.svg)
[![crates version](https://img.shields.io/crates/v/infer.svg)](https://crates.io/crates/infer)
[![documentation](https://docs.rs/infer/badge.svg)](https://docs.rs/infer)

Small crate to infer file and MIME type by checking the
[magic number](https://en.wikipedia.org/wiki/Magic_number_(programming)) signature.

Adaptation of [filetype](https://github.com/h2non/filetype) Go package ported to Rust.

Does not require magic file database (i.e. `/etc/magic`).

## Features

- Supports a [wide range](#supported-types) of file types
- Provides file extension and MIME type
- File discovery by extension or MIME type
- File discovery by class (image, video, audio...)
- Supports custom new types and matchers

## Installation

This crate works with Cargo and is on [crates.io](https://crates.io/crates/infer).
Add it to your `Cargo.toml` like so:

```toml
[dependencies]
infer = "0.3"
```

If you are not using the custom matcher or the file type from file path functionality you
can make this crate even lighter by importing it with no default features, like so:

```toml
[dependencies]
infer = { version = "0.3", default-features = false }
```

## no_std and no_alloc support

This crate supports `no_std` and `no_alloc` environments. `std` support is enabled by default,
but you can disable it by importing the crate with no default features, making it depend
only on the Rust `core` Library.

`alloc` has to be enabled to be able to use custom file matchers.

`std` has to be enabled to be able to get the file type from a file given the file path.

## Examples

Most operations can be done via _top level functions_, but they are also available through the `Infer`
struct, which must be used when dealing custom matchers.

### Get the type of a buffer

```rust
let buf = [0xFF, 0xD8, 0xFF, 0xAA];
let kind = infer::get(&buf).expect("file type is known");

assert_eq!(kind.mime_type(), "image/jpeg");
assert_eq!(kind.extension(), "jpg");
```

### Check file type by path

```rust
let kind = infer::get_from_path("testdata/sample.jpg")
    .expect("file read successfully")
    .expect("file type is known");

assert_eq!(kind.mime_type(), "image/jpeg");
assert_eq!(kind.extension(), "jpg");
```

### Check for specific type

```rust
let buf = [0xFF, 0xD8, 0xFF, 0xAA];
assert!(infer::image::is_jpeg(&buf));
```

### Check for specific type class

```rust
let buf = [0xFF, 0xD8, 0xFF, 0xAA];
assert!(infer::is_image(&buf));
```

### Adds a custom file type matcher

```rust
fn custom_matcher(buf: &[u8]) -> bool {
    return buf.len() >= 3 && buf[0] == 0x10 && buf[1] == 0x11 && buf[2] == 0x12;
}

let mut info = infer::Infer::new();
info.add("custom/foo", "foo", custom_matcher);

let buf = [0x10, 0x11, 0x12, 0x13];
let kind = info.get(&buf).expect("file type is known");

assert_eq!(kind.mime_type(), "custom/foo");
assert_eq!(kind.extension(), "foo");
```

## Supported types

#### Image

- **jpg** - `image/jpeg`
- **png** - `image/png`
- **gif** - `image/gif`
- **webp** - `image/webp`
- **cr2** - `image/x-canon-cr2`
- **tif** - `image/tiff`
- **bmp** - `image/bmp`
- **heif** - `image/heif`
- **avif** - `image/avif`
- **jxr** - `image/vnd.ms-photo`
- **psd** - `image/vnd.adobe.photoshop`
- **ico** - `image/vnd.microsoft.icon`
- **ora** - `image/openraster`
- **djvu** - `image/vnd.djvu`

#### Video

- **mp4** - `video/mp4`
- **m4v** - `video/x-m4v`
- **mkv** - `video/x-matroska`
- **webm** - `video/webm`
- **mov** - `video/quicktime`
- **avi** - `video/x-msvideo`
- **wmv** - `video/x-ms-wmv`
- **mpg** - `video/mpeg`
- **flv** - `video/x-flv`

#### Audio

- **mid** - `audio/midi`
- **mp3** - `audio/mpeg`
- **m4a** - `audio/m4a`
- **ogg** - `audio/ogg`
- **flac** - `audio/x-flac`
- **wav** - `audio/x-wav`
- **amr** - `audio/amr`
- **aac** - `audio/aac`
- **aiff** - `audio/x-aiff`
- **dsf** - `audio/x-dsf`
- **ape** - `audio/x-ape`

#### Archive

- **epub** - `application/epub+zip`
- **zip** - `application/zip`
- **tar** - `application/x-tar`
- **rar** - `application/vnd.rar`
- **gz** - `application/gzip`
- **bz2** - `application/x-bzip2`
- **bz3** - `application/vnd.bzip3`
- **7z** - `application/x-7z-compressed`
- **xz** - `application/x-xz`
- **pdf** - `application/pdf`
- **swf** - `application/x-shockwave-flash`
- **rtf** - `application/rtf`
- **eot** - `application/octet-stream`
- **ps** - `application/postscript`
- **sqlite** - `application/vnd.sqlite3`
- **nes** - `application/x-nintendo-nes-rom`
- **crx** - `application/x-google-chrome-extension`
- **cab** - `application/vnd.ms-cab-compressed`
- **deb** - `application/vnd.debian.binary-package`
- **ar** - `application/x-unix-archive`
- **Z** - `application/x-compress`
- **lz** - `application/x-lzip`
- **rpm** - `application/x-rpm`
- **dcm** - `application/dicom`
- **zst** - `application/zstd`
- **lz4** - `application/x-lz4`
- **msi** - `application/x-ole-storage`
- **cpio** - `application/x-cpio`
- **par2** - `application/x-par2`

#### Book

- **epub** - `application/epub+zip`
- **mobi** - `application/x-mobipocket-ebook`

#### Documents

- **doc** - `application/msword`
- **docx** - `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- **xls** - `application/vnd.ms-excel`
- **xlsx** - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- **ppt** - `application/vnd.ms-powerpoint`
- **pptx** - `application/vnd.openxmlformats-officedocument.presentationml.presentation`
- **odt** - `application/vnd.oasis.opendocument.text`
- **ods** - `application/vnd.oasis.opendocument.spreadsheet`
- **odp** - `application/vnd.oasis.opendocument.presentation`

#### Font

- **woff** - `application/font-woff`
- **woff2** - `application/font-woff`
- **ttf** - `application/font-sfnt`
- **otf** - `application/font-sfnt`

#### Application

- **wasm** - `application/wasm`
- **exe** - `application/vnd.microsoft.portable-executable`
- **dll** - `application/vnd.microsoft.portable-executable`
- **elf** - `application/x-executable`
- **bc** - `application/llvm`
- **mach** - `application/x-mach-binary`
- **class** - `application/java`
- **dex** - `application/vnd.android.dex`
- **dey** - `application/vnd.android.dey`
- **der** - `application/x-x509-ca-cert`
- **obj** - `application/x-executable`

## Known Issues

- `exe` and `dll` have the same magic number so it's not possible to tell which one just based on the binary data. `exe` is returned for all.

## License

MIT
