use crate::sftp::{SftpBackend, SftpManager};
use russh_sftp::client::SftpSession;
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::Mutex;

pub mod editor;
mod dir;
mod ops;
mod tar;
mod transfer;

pub use dir::*;
pub use ops::*;
pub use tar::*;
pub use transfer::*;

pub(super) const CHUNK_SIZE: usize = 256 * 1024; // 256 KB

#[derive(Serialize, Clone)]
pub struct RemoteFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub modified: Option<u64>,
    pub permissions: Option<u32>,
}

#[derive(Serialize, Clone)]
pub struct TransferProgress {
    pub transferred: u64,
    pub total: u64,
}

pub(super) async fn get_session<'a>(
    manager: &'a SftpManager,
    sftp_id: &'a str,
) -> Result<Arc<Mutex<SftpSession>>, String> {
    manager
        .get(sftp_id)
        .await
        .ok_or_else(|| format!("SFTP session '{}' not found", sftp_id))
}

pub(super) async fn get_backend(
    manager: &SftpManager,
    sftp_id: &str,
) -> Result<SftpBackend, String> {
    manager
        .backend(sftp_id)
        .await
        .ok_or_else(|| format!("SFTP session '{}' not found", sftp_id))
}

pub(super) fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

pub(super) fn temp_archive_name(transfer_id: &str) -> String {
    format!("tf_{}.tar.gz", transfer_id)
}
