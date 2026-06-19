use super::get_backend;
use crate::sftp::{SftpBackend, SftpManager};
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

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

const SNIFF_BYTES: usize = 8 * 1024;

#[tauri::command]
pub async fn sftp_read_file(
    sftp_state: State<'_, SftpManager>,
    sftp_id: String,
    path: String,
    max_bytes: u64,
) -> Result<EditorFile, ReadError> {
    let bytes: Vec<u8> = match get_backend(&sftp_state, &sftp_id).await? {
        SftpBackend::Docker(d) => {
            let size = d.file_size(&path).await;
            if size > max_bytes {
                return Err(ReadError::TooLarge { size, limit: max_bytes });
            }
            d.read_file(&path).await?
        }
        SftpBackend::Real(session) => {
            let sftp = session.lock().await;
            let meta = sftp
                .metadata(&path)
                .await
                .map_err(|e| ReadError::Io { message: format!("stat failed: {e}") })?;
            if let Some(size) = meta.size {
                if size > max_bytes {
                    return Err(ReadError::TooLarge { size, limit: max_bytes });
                }
            }
            let mut file = sftp
                .open(&path)
                .await
                .map_err(|e| ReadError::Io { message: format!("open failed: {e}") })?;
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)
                .await
                .map_err(|e| ReadError::Io { message: format!("read failed: {e}") })?;
            buf
        }
    };
    if bytes.len() as u64 > max_bytes {
        return Err(ReadError::TooLarge { size: bytes.len() as u64, limit: max_bytes });
    }
    let sample = &bytes[..bytes.len().min(SNIFF_BYTES)];
    if is_binary(sample) {
        return Err(ReadError::Binary);
    }
    let size = bytes.len() as u64;
    Ok(EditorFile {
        content: String::from_utf8_lossy(&bytes).into_owned(),
        size,
    })
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
    match get_backend(&sftp_state, &sftp_id).await? {
        SftpBackend::Docker(d) => d.write_file(&path, &content).await,
        SftpBackend::Real(session) => {
            let sftp = session.lock().await;
            let mut file = sftp
                .open_with_flags(
                    &path,
                    OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
                )
                .await
                .map_err(|e| format!("open for write failed: {e}"))?;
            file.write_all(content.as_bytes())
                .await
                .map_err(|e| format!("write failed: {e}"))?;
            file.flush().await.map_err(|e| format!("flush failed: {e}"))?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_binary;

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
