use super::resume::copy_tree;
use super::{backend_transfer_command, get_sftp_fs, with_transfer};
use crate::error::AppError;
use crate::sftp::SftpManager;
use tauri::{AppHandle, State};

// ── Directory transfer ────────────────────────────────────────────────────────

backend_transfer_command!(sftp_upload_dir, upload_dir, local_path, remote_path);

backend_transfer_command!(sftp_download_dir, download_dir, remote_path, local_path);

/// Transfer a directory recursively between two remote SFTP sessions.
#[tauri::command]
pub async fn sftp_transfer_dir(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    src_sftp_id: String,
    src_path: String,
    dst_sftp_id: String,
    dst_path: String,
    transfer_id: String,
) -> Result<(), AppError> {
    let src = get_sftp_fs(&sftp_state, &src_sftp_id).await?;
    let dst = get_sftp_fs(&sftp_state, &dst_sftp_id).await?;
    with_transfer(&sftp_state, &transfer_id.clone(), |token| async move {
        copy_tree(&app, &src, &src_path, &dst, &dst_path, &transfer_id, &token).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::sftp::resume::{endpoint::LocalFs, sftp_fs::SftpFs, walk};
    use crate::sftp::backend::test_tree::{assert_downloaded, children, lookup, Recorder, ROOT};
    use russh_sftp::client::SftpSession;
    use russh_sftp::protocol::{
        Attrs, Data, File, FileAttributes, Handle, Name, OpenFlags, Status, StatusCode,
    };
    use std::collections::HashSet;
    use std::sync::Arc;
    use tokio::sync::Mutex;
    use tokio_util::sync::CancellationToken;

    /// Serves `test_tree` over SFTP; `listed` ends each directory listing after one batch.
    #[derive(Default)]
    struct TreeServer {
        listed: HashSet<String>,
    }

    fn attrs(content: Option<&str>) -> FileAttributes {
        let mut attrs = FileAttributes::empty();
        match content {
            Some(c) => {
                attrs.set_regular(true);
                attrs.size = Some(c.len() as u64);
            }
            None => attrs.set_dir(true),
        }
        attrs
    }

    impl russh_sftp::server::Handler for TreeServer {
        type Error = StatusCode;

        fn unimplemented(&self) -> StatusCode {
            StatusCode::OpUnsupported
        }

        async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, StatusCode> {
            self.listed.remove(&path);
            Ok(Handle { id, handle: path })
        }

        async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, StatusCode> {
            if !self.listed.insert(handle.clone()) {
                return Err(StatusCode::Eof);
            }
            let files = children(&handle)
                .map(|(name, content)| File::new(name, attrs(content)))
                .collect();
            Ok(Name { id, files })
        }

        async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, StatusCode> {
            let content = lookup(&path).ok_or(StatusCode::NoSuchFile)?;
            Ok(Attrs {
                id,
                attrs: attrs(content),
            })
        }

        async fn open(
            &mut self,
            id: u32,
            filename: String,
            _: OpenFlags,
            _: FileAttributes,
        ) -> Result<Handle, StatusCode> {
            lookup(&filename).flatten().ok_or(StatusCode::NoSuchFile)?;
            Ok(Handle {
                id,
                handle: filename,
            })
        }

        async fn read(
            &mut self,
            id: u32,
            handle: String,
            offset: u64,
            len: u32,
        ) -> Result<Data, StatusCode> {
            let content = lookup(&handle)
                .flatten()
                .ok_or(StatusCode::NoSuchFile)?
                .as_bytes();
            let start = offset as usize;
            if start >= content.len() {
                return Err(StatusCode::Eof);
            }
            let end = content.len().min(start + len as usize);
            Ok(Data {
                id,
                data: content[start..end].to_vec(),
            })
        }

        async fn close(&mut self, id: u32, _: String) -> Result<Status, StatusCode> {
            Ok(Status {
                id,
                status_code: StatusCode::Ok,
                error_message: "Ok".into(),
                language_tag: "en-US".into(),
            })
        }
    }

    async fn serve_tree() -> Arc<Mutex<SftpSession>> {
        let (client, server) = tokio::io::duplex(1 << 16);
        russh_sftp::server::run(server, TreeServer::default()).await;
        Arc::new(Mutex::new(SftpSession::new(client).await.unwrap()))
    }

    #[tokio::test]
    async fn sftp_folder_download_skips_and_reports_names_this_system_cannot_hold() {
        let session = serve_tree().await;
        let events = Recorder::default();
        let tmp = tempfile::tempdir().unwrap();
        let dst = tmp.path().join("dst");

        copy_tree(
            &events,
            &SftpFs::detached(session),
            ROOT,
            &LocalFs,
            &dst.to_string_lossy(),
            "t-sftp",
            &CancellationToken::new(),
        )
        .await
        .unwrap();

        assert_downloaded(&dst, events.skipped("t-sftp"));
    }

    #[tokio::test]
    async fn server_to_server_walk_keeps_names_only_the_local_system_refuses() {
        let session = serve_tree().await;
        let events = Recorder::default();
        let (dirs, files) = walk(&events, "t-rr", &SftpFs::detached(session), ROOT, false)
            .await
            .unwrap();

        let mut rels: Vec<&str> = files.iter().map(|f| f.rel.as_str()).collect();
        rels.sort();
        assert_eq!(rels, ["10:30.log", "a\\b", "ok.txt", "sub/inner.txt"]);
        assert_eq!(dirs, ["sub"]);
        assert_eq!(events.skipped("t-rr"), ["/src/../escape"]);
    }
}
