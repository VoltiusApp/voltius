use core::convert::TryInto;

use super::compare_bytes;

#[allow(clippy::upper_case_acronyms)]
#[derive(Debug, Eq, PartialEq)]
enum DocType {
    DOC,
    DOCX,
    XLS,
    XLSX,
    PPT,
    PPTX,
    OOXML,
}

/// Returns whether a buffer is Microsoft Word Document (DOC) data.
pub fn is_doc(buf: &[u8]) -> bool {
    ole2(buf) == Some(DocType::DOC)
}

/// Returns whether a buffer is Microsoft Word Open XML Format Document (DOCX) data.
pub fn is_docx(buf: &[u8]) -> bool {
    msooxml(buf) == Some(DocType::DOCX)
}

/// Returns whether a buffer is Microsoft Excel 97-2003 Worksheet (XLS) data.
pub fn is_xls(buf: &[u8]) -> bool {
    ole2(buf) == Some(DocType::XLS)
}

/// Returns whether a buffer is Microsoft Excel Open XML Format Spreadsheet (XLSX) data.
pub fn is_xlsx(buf: &[u8]) -> bool {
    msooxml(buf) == Some(DocType::XLSX)
}

/// Returns whether a buffer is Microsoft PowerPoint 97-2003 Presentation (PPT) data.
pub fn is_ppt(buf: &[u8]) -> bool {
    ole2(buf) == Some(DocType::PPT)
}

/// Returns whether a buffer is Microsoft PowerPoint Open XML Presentation (PPTX) data.
pub fn is_pptx(buf: &[u8]) -> bool {
    msooxml(buf) == Some(DocType::PPTX)
}

fn msooxml(buf: &[u8]) -> Option<DocType> {
    let signature = [b'P', b'K', 0x03, 0x04];

    // start by checking for ZIP local file header signature
    if !compare_bytes(buf, &signature, 0) {
        return None;
    }

    let v = check_msooml(buf, 0x1E);
    if v.is_some() {
        return v;
    }

    if !compare_bytes(buf, b"[Content_Types].xml", 0x1E)
        && !compare_bytes(buf, b"_rels/.rels", 0x1E)
        && !compare_bytes(buf, b"docProps", 0x1E)
    {
        return None;
    }

    // skip to the second local file header
    // since some documents include a 520-byte extra field following the file
    // header, we need to scan for the next header
    let mut start_offset = match u32::from_le_bytes(buf[18..22].try_into().unwrap()).checked_add(49)
    {
        Some(int) => int as usize,
        None => return None,
    };

    let idx = search(buf, start_offset, 6000)?;

    // now skip to the *third* local file header; again, we need to scan due to a
    // 520-byte extra field following the file header
    start_offset += idx + 4 + 26;
    let idx = search(buf, start_offset, 6000)?;

    // and check the subdirectory name to determine which type of OOXML
    // file we have.  Correct the mimetype with the registered ones:
    // http://technet.microsoft.com/en-us/library/cc179224.aspx
    start_offset += idx + 4 + 26;
    check_msooml(buf, start_offset)?;

    // OpenOffice/Libreoffice orders ZIP entry differently, so check the 4th file
    start_offset += 26;
    let idx = search(buf, start_offset, 6000);
    match idx {
        Some(idx) => start_offset += idx + 4 + 26,
        None => return Some(DocType::OOXML),
    };

    let typo = check_msooml(buf, start_offset);
    if typo.is_some() {
        return typo;
    }

    Some(DocType::OOXML)
}

#[cfg(feature = "std")]
fn ole2(buf: &[u8]) -> Option<DocType> {
    use std::io::Cursor;

    if !compare_bytes(buf, &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], 0) {
        return None;
    }
    if let Ok(file) = cfb::CompoundFile::open(Cursor::new(buf)) {
        return match file.root_entry().clsid().to_string().as_str() {
            "00020810-0000-0000-c000-000000000046" | "00020820-0000-0000-c000-000000000046" => {
                Some(DocType::XLS)
            }
            "00020906-0000-0000-c000-000000000046" => Some(DocType::DOC),
            "64818d10-4f9b-11cf-86ea-00aa00b929e8" => Some(DocType::PPT),
            _ => None,
        };
    }
    None
}

#[cfg(not(feature = "std"))]
fn ole2(buf: &[u8]) -> Option<DocType> {
    if !compare_bytes(buf, &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], 0) {
        return None;
    }
    Some(DocType::DOC)
}

fn check_msooml(buf: &[u8], offset: usize) -> Option<DocType> {
    if compare_bytes(buf, b"word/", offset) {
        Some(DocType::DOCX)
    } else if compare_bytes(buf, b"ppt/", offset) {
        Some(DocType::PPTX)
    } else if compare_bytes(buf, b"xl/", offset) {
        Some(DocType::XLSX)
    } else {
        None
    }
}

fn search(buf: &[u8], start: usize, range: usize) -> Option<usize> {
    let length = buf.len();
    let mut end = start + range;
    let signature: &[_] = &[b'P', b'K', 0x03, 0x04];

    if end > length {
        end = length;
    }

    if start >= end {
        return None;
    }

    buf[start..end]
        .windows(signature.len())
        .position(|window| window == signature)
}
