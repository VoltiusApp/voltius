use super::get_backend;
use crate::sftp::SftpManager;
use serde::Serialize;
use std::future::Future;
use tauri::ipc::Response;
use tauri::State;
use tokio::io::{AsyncRead, AsyncReadExt};

#[derive(Serialize)]
pub struct EditorFile {
    pub content: String,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReadError {
    TooLarge { size: u64, limit: u64 },
    Binary,
    Image { mime: &'static str, size: u64 },
    Io { message: String },
}

impl From<String> for ReadError {
    fn from(message: String) -> Self {
        ReadError::Io { message }
    }
}

/// Heuristic: NUL byte, or >30% bytes outside the printable/whitespace set in the sample.
pub fn is_binary(sample: &[u8]) -> bool {
    if sample.is_empty() {
        return false;
    }
    if sample.contains(&0) {
        return true;
    }
    let non_text = sample
        .iter()
        .filter(|&&b| b < 0x09 || (b > 0x0d && b < 0x20))
        .count();
    non_text * 100 / sample.len() > 30
}

pub const SNIFF_BYTES: usize = 8 * 1024;

const PREVIEW_MIMES: [&str; 7] = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/vnd.microsoft.icon",
    "image/avif",
];

/// An image type every webview can show, decided by the file's bytes, never its name.
pub fn sniff_image(head: &[u8]) -> Option<&'static str> {
    if is_svg(head) {
        return Some("image/svg+xml");
    }
    let mime = infer::get(head)?.mime_type();
    PREVIEW_MIMES.into_iter().find(|m| *m == mime)
}

fn is_svg(head: &[u8]) -> bool {
    let text = String::from_utf8_lossy(head);
    let mut rest = text.trim_start_matches('\u{feff}').trim_start();
    loop {
        let skipped = [("<?", "?>"), ("<!--", "-->"), ("<!DOCTYPE", ">")]
            .into_iter()
            .find_map(|(open, close)| {
                rest.strip_prefix(open)
                    .map(|r| r.split_once(close).map_or("", |(_, after)| after))
            });
        match skipped {
            Some(after) => rest = after.trim_start(),
            None => break,
        }
    }
    rest.strip_prefix("<svg")
        .is_some_and(|r| r.starts_with(|c: char| c.is_whitespace() || c == '>' || c == '/'))
}

/// How many bytes a backend reads for an editor capped at `max_bytes`: one past
/// the cap, so a longer result shows the file is too large without reading it all.
pub fn read_limit(max_bytes: u64) -> u64 {
    max_bytes.saturating_add(1)
}

/// Read `reader` to its end, but never past `read_limit(max_bytes)`. The size a
/// server reports can't bound the read: it is 0 for `/dev/zero`, `/dev/urandom`
/// or a FIFO, which never end, and buffering those exhausts memory.
pub async fn read_capped<R: AsyncRead + Unpin>(
    reader: R,
    max_bytes: u64,
) -> std::io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    reader
        .take(read_limit(max_bytes))
        .read_to_end(&mut buf)
        .await?;
    Ok(buf)
}

fn too_large(size: u64, limit: u64) -> ReadError {
    ReadError::TooLarge { size, limit }
}

/// Text costs one read. A file past the cap costs a sniff, so an image is
/// still reported as one whatever its size.
pub async fn read_for_editor<F, Fut>(
    size: u64,
    max_bytes: u64,
    read: F,
) -> Result<EditorFile, ReadError>
where
    F: Fn(u64) -> Fut,
    Fut: Future<Output = Result<Vec<u8>, String>>,
{
    if size > max_bytes {
        let head = read(SNIFF_BYTES as u64).await?;
        return Err(match sniff_image(&head) {
            Some(mime) => ReadError::Image { mime, size },
            None => too_large(size, max_bytes),
        });
    }
    let bytes = read(max_bytes).await?;
    let len = bytes.len() as u64;
    let head = &bytes[..bytes.len().min(SNIFF_BYTES)];
    if let Some(mime) = sniff_image(head) {
        return Err(ReadError::Image { mime, size: len });
    }
    if len > max_bytes {
        return Err(too_large(len, max_bytes));
    }
    if is_binary(head) {
        return Err(ReadError::Binary);
    }
    Ok(EditorFile {
        size: len,
        content: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// The image as the raw IPC body: its MIME type, a newline, then its bytes.
/// Anything that isn't a previewable image is `Binary`, so the caller falls back to text.
pub async fn read_image<F, Fut>(size: u64, max_bytes: u64, read: F) -> Result<Response, ReadError>
where
    F: Fn(u64) -> Fut,
    Fut: Future<Output = Result<Vec<u8>, String>>,
{
    if size > max_bytes {
        let head = read(SNIFF_BYTES as u64).await?;
        return Err(match sniff_image(&head) {
            Some(_) => too_large(size, max_bytes),
            None => ReadError::Binary,
        });
    }
    let bytes = read(max_bytes).await?;
    let Some(mime) = sniff_image(&bytes) else {
        return Err(ReadError::Binary);
    };
    if bytes.len() as u64 > max_bytes {
        return Err(too_large(bytes.len() as u64, max_bytes));
    }
    Ok(Response::new(frame_image(mime, &bytes)))
}

fn frame_image(mime: &str, bytes: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(mime.len() + 1 + bytes.len());
    body.extend_from_slice(mime.as_bytes());
    body.push(b'\n');
    body.extend_from_slice(bytes);
    body
}

#[tauri::command]
pub async fn sftp_read_file(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
    max_bytes: u64,
) -> Result<EditorFile, ReadError> {
    let backend = get_backend(&sftp_state, &sftp_id).await?;
    let size = backend.file_size(&path).await;
    read_for_editor(size, max_bytes, |limit| backend.read_file(&path, limit)).await
}

#[tauri::command]
pub async fn sftp_read_image(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
    max_bytes: u64,
) -> Result<Response, ReadError> {
    let backend = get_backend(&sftp_state, &sftp_id).await?;
    let size = backend.file_size(&path).await;
    read_image(size, max_bytes, |limit| backend.read_file(&path, limit)).await
}

#[tauri::command]
pub async fn sftp_write_file(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let lock = sftp_state.path_lock(&sftp_id, &path).await;
    let _guard = lock.lock().await;
    get_backend(&sftp_state, &sftp_id)
        .await?
        .write_file(&path, &content)
        .await
}

#[cfg(test)]
mod tests {
    use super::{
        frame_image, is_binary, read_capped, read_for_editor, read_image, sniff_image, ReadError,
        SNIFF_BYTES,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0";

    type Read = std::future::Ready<Result<Vec<u8>, String>>;

    fn file(bytes: Vec<u8>) -> (impl Fn(u64) -> Read, Arc<AtomicUsize>) {
        let reads = Arc::new(AtomicUsize::new(0));
        let counter = reads.clone();
        let read = move |limit: u64| {
            counter.fetch_add(1, Ordering::Relaxed);
            let end = bytes.len().min(limit.saturating_add(1) as usize);
            std::future::ready(Ok(bytes[..end].to_vec()))
        };
        (read, reads)
    }

    #[test]
    fn sniffs_raster_images_by_signature() {
        assert_eq!(sniff_image(PNG), Some("image/png"));
        assert_eq!(
            sniff_image(b"\xff\xd8\xff\xe0\0\x10JFIF\0"),
            Some("image/jpeg")
        );
        assert_eq!(sniff_image(b"GIF89a\x01\0\x01\0"), Some("image/gif"));
        assert_eq!(sniff_image(b"RIFF\x24\0\0\0WEBPVP8 "), Some("image/webp"));
    }

    #[test]
    fn sniffs_svg_past_prolog_comments_and_doctype() {
        assert_eq!(
            sniff_image(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
            Some("image/svg+xml")
        );
        let decorated = "\u{feff}<?xml version=\"1.0\"?>\n<!-- logo -->\n<!DOCTYPE svg>\n<svg>";
        assert_eq!(sniff_image(decorated.as_bytes()), Some("image/svg+xml"));
    }

    #[test]
    fn leaves_everything_else_alone() {
        assert_eq!(sniff_image(b"TODO before Friday\n"), None);
        assert_eq!(sniff_image(b"<svgfoo/>"), None);
        assert_eq!(sniff_image(b"<?xml version=\"1.0\"?><html/>"), None);
        assert_eq!(sniff_image(b"%PDF-1.7\n"), None);
        assert_eq!(sniff_image(b""), None);
    }

    #[tokio::test]
    async fn text_is_read_once_whatever_its_size() {
        for text in ["hello".to_string(), "a".repeat(SNIFF_BYTES * 3)] {
            let (read, reads) = file(text.clone().into_bytes());
            let got = read_for_editor(text.len() as u64, 1 << 20, read)
                .await
                .ok()
                .unwrap();
            assert_eq!(got.content, text);
            assert_eq!(reads.load(Ordering::Relaxed), 1);
        }
    }

    #[tokio::test]
    async fn an_image_within_the_cap_is_reported_after_one_read() {
        let (read, reads) = file(PNG.to_vec());
        let err = read_for_editor(PNG.len() as u64, 1 << 20, read)
            .await
            .err()
            .unwrap();
        assert!(matches!(
            err,
            ReadError::Image {
                mime: "image/png",
                ..
            }
        ));
        assert_eq!(reads.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn past_the_cap_one_sniff_tells_an_image_from_large_text() {
        let mut image = PNG.to_vec();
        image.resize(SNIFF_BYTES * 4, 0);
        let (read, reads) = file(image);
        let err = read_for_editor((SNIFF_BYTES * 4) as u64, 100, read)
            .await
            .err()
            .unwrap();
        assert!(matches!(
            err,
            ReadError::Image {
                mime: "image/png",
                ..
            }
        ));
        assert_eq!(reads.load(Ordering::Relaxed), 1);
        let (read, _) = file(vec![b'a'; 64]);
        assert!(matches!(
            read_for_editor(64, 10, read).await,
            Err(ReadError::TooLarge {
                size: 64,
                limit: 10
            })
        ));
    }

    #[tokio::test]
    async fn unknown_binary_keeps_its_error() {
        let (read, _) = file(vec![0u8; 64]);
        assert!(matches!(
            read_for_editor(64, 1024, read).await,
            Err(ReadError::Binary)
        ));
    }

    #[tokio::test]
    async fn read_image_returns_an_image_in_one_read() {
        let (read, reads) = file(PNG.to_vec());
        assert!(read_image(PNG.len() as u64, 1024, read).await.is_ok());
        assert_eq!(reads.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn the_mime_type_precedes_the_bytes() {
        assert_eq!(frame_image("image/png", b"\x89PNG"), b"image/png\n\x89PNG");
    }

    #[tokio::test]
    async fn read_image_past_the_cap_sniffs_instead_of_reading_it_all() {
        let mut image = PNG.to_vec();
        image.resize(SNIFF_BYTES * 4, 0);
        let (read, reads) = file(image);
        assert!(matches!(
            read_image((SNIFF_BYTES * 4) as u64, 100, read).await,
            Err(ReadError::TooLarge { limit: 100, .. })
        ));
        assert_eq!(reads.load(Ordering::Relaxed), 1);
        let (read, _) = file(vec![b'a'; 64]);
        assert!(matches!(
            read_image(64, 10, read).await,
            Err(ReadError::Binary)
        ));
    }

    #[tokio::test]
    async fn read_image_refuses_a_file_that_is_not_an_image() {
        let (read, _) = file(b"plain text".to_vec());
        assert!(matches!(
            read_image(10, 1024, read).await,
            Err(ReadError::Binary)
        ));
    }

    #[tokio::test]
    async fn an_endless_source_is_read_only_past_the_cap() {
        let bytes = read_capped(tokio::io::repeat(0), 10).await.unwrap();
        assert_eq!(bytes.len(), 11);
    }

    #[tokio::test]
    async fn a_file_within_the_cap_is_read_whole() {
        assert_eq!(read_capped(&b"hello"[..], 5).await.unwrap(), b"hello");
        assert_eq!(read_capped(&b"hello"[..], 4).await.unwrap(), b"hello");
        assert_eq!(read_capped(&b"hello"[..], 3).await.unwrap(), b"hell");
    }

    #[test]
    fn detects_text() {
        assert!(!is_binary(b"hello world\nsecond line\n"));
        assert!(!is_binary("café déjà".as_bytes()));
    }

    #[test]
    fn detects_binary_nul() {
        assert!(is_binary(b"PNG\x00\x00\x01\x02data"));
    }

    #[test]
    fn detects_binary_ratio() {
        let mut v = vec![0x01u8; 100]; // mostly control bytes
        v.extend_from_slice(b"abc");
        assert!(is_binary(&v));
    }
}
