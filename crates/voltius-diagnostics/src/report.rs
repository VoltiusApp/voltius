use std::io::{Seek, Write};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// One file inside the report bundle.
pub struct ReportEntry {
    pub name: String,
    pub bytes: Vec<u8>,
}

/// Write `entries` into a deflate-compressed zip. Pure and infallible on
/// content — only propagates writer I/O errors.
pub fn write_report_zip<W: Write + Seek>(
    entries: &[ReportEntry],
    writer: W,
) -> std::io::Result<()> {
    let mut zip = ZipWriter::new(writer);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for entry in entries {
        zip.start_file(&entry.name, opts)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        zip.write_all(&entry.bytes)?;
    }
    zip.finish()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn produces_zip_with_expected_entries() {
        let entries = vec![
            ReportEntry {
                name: "voltius.log".into(),
                bytes: b"hello log".to_vec(),
            },
            ReportEntry {
                name: "system.json".into(),
                bytes: b"{}".to_vec(),
            },
            ReportEntry {
                name: "README.txt".into(),
                bytes: b"readme".to_vec(),
            },
        ];
        let mut buf = Cursor::new(Vec::new());
        write_report_zip(&entries, &mut buf).unwrap();

        buf.set_position(0);
        let mut archive = zip::ZipArchive::new(buf).unwrap();
        assert_eq!(archive.len(), 3);
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.contains(&"voltius.log".to_string()));
        assert!(names.contains(&"system.json".to_string()));
        assert!(names.contains(&"README.txt".to_string()));
    }

    #[test]
    fn empty_entries_still_valid_zip() {
        let mut buf = Cursor::new(Vec::new());
        write_report_zip(&[], &mut buf).unwrap();
        buf.set_position(0);
        let archive = zip::ZipArchive::new(buf).unwrap();
        assert_eq!(archive.len(), 0);
    }
}
