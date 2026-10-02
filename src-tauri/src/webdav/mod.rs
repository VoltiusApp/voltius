pub mod connector;
pub mod multistatus;
pub mod paths;

use crate::commands::sftp::editor::read_capped;
use crate::commands::sftp::{pump_chunks, sort_listing, RemoteFile};
use crate::error::{AppError, ErrorCode};
use crate::known_hosts::{ConflictPrompt, KnownHostsStore};
use crate::proxy::{ProxyError, ProxySpec};
use crate::sftp::backend::TransferEvents;
use crate::sftp::FileBackend;
use async_trait::async_trait;
use base64::Engine;
use bytes::Bytes;
use connector::{DavConnector, RESPONSE_TIMEOUT, SLOW_RESPONSE_TIMEOUT};
use futures_util::TryStreamExt;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, BodyStream, Empty, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::header::{self, HeaderName, HeaderValue};
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use multistatus::DavEntry;
use paths::{normalize, same_origin_join, DavBase};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWriteExt};
use tokio_util::io::{ReaderStream, StreamReader};
use tokio_util::sync::CancellationToken;
use url::Url;

type Body = BoxBody<Bytes, std::io::Error>;

const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>"#;
const UPLOAD_PIPE: usize = 256 * 1024;
const REFUSAL_GRACE: Duration = Duration::from_secs(1);
// Below Apache's 5 s keep-alive, so a pooled connection is dropped before the server closes it.
const POOL_IDLE: Duration = Duration::from_secs(4);

pub struct WebDavBackend {
    client: Client<DavConnector, Body>,
    connector: DavConnector,
    base: DavBase,
    auth: HeaderValue,
}

fn method(name: &'static str) -> Method {
    Method::from_bytes(name.as_bytes()).expect("WebDAV method names are valid tokens")
}

fn empty() -> Body {
    Empty::new().map_err(|never| match never {}).boxed()
}

fn full(data: impl Into<Bytes>) -> Body {
    Full::new(data.into())
        .map_err(|never| match never {})
        .boxed()
}

fn basic_auth(username: &str, password: &str) -> HeaderValue {
    let token = base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"));
    let mut value =
        HeaderValue::from_str(&format!("Basic {token}")).expect("base64 is header-safe");
    value.set_sensitive(true);
    value
}

fn status_error(op: &str, status: StatusCode) -> AppError {
    status_error_with(op, status, status_code(status))
}

fn status_error_with(op: &str, status: StatusCode, code: Option<ErrorCode>) -> AppError {
    let message = format!("{op} failed: HTTP {status}");
    match code {
        Some(code) => AppError::coded(code, message),
        None => message.into(),
    }
}

fn status_code(status: StatusCode) -> Option<ErrorCode> {
    match status.as_u16() {
        401 => Some(ErrorCode::LoginRejected),
        403 => Some(ErrorCode::PermissionDenied),
        404 | 409 => Some(ErrorCode::NotFound),
        412 => Some(ErrorCode::AlreadyExists),
        423 => Some(ErrorCode::ResourceLocked),
        507 => Some(ErrorCode::StorageFull),
        _ => None,
    }
}

fn transport_error(op: &str, err: &(dyn std::error::Error + 'static)) -> AppError {
    let mut innermost = err;
    let mut lost = false;
    let mut cause = Some(err);
    while let Some(e) = cause {
        if let Some(io) = e.downcast_ref::<std::io::Error>() {
            return match io
                .get_ref()
                .and_then(|inner| inner.downcast_ref::<ProxyError>())
            {
                Some(proxy) => AppError::caused(op, proxy),
                None => AppError::caused(op, io),
            };
        }
        if let Some(h) = e.downcast_ref::<hyper::Error>() {
            lost |= h.is_incomplete_message() || h.is_closed();
        }
        innermost = e;
        cause = e.source();
    }
    let message = format!("{op}: {innermost}");
    if lost {
        AppError::coded(ErrorCode::ConnectionLost, message)
    } else {
        message.into()
    }
}

fn body_reader(resp: Response<Incoming>) -> impl AsyncRead + Unpin + Send {
    let frames = BodyStream::new(resp.into_body())
        .try_filter_map(|frame| futures_util::future::ready(Ok(frame.into_data().ok())))
        .map_err(std::io::Error::other);
    StreamReader::new(Box::pin(frames))
}

fn propfind_headers(depth: &'static str) -> Vec<(HeaderName, String)> {
    vec![
        (HeaderName::from_static("depth"), depth.into()),
        (
            header::CONTENT_TYPE,
            "application/xml; charset=utf-8".into(),
        ),
    ]
}

/// GET/PUT stream for as long as they take; DELETE/MOVE may recurse through a large folder.
fn response_window(method: &Method) -> Option<Duration> {
    if method == Method::GET || method == Method::PUT {
        None
    } else if method == Method::DELETE || method.as_str() == "MOVE" {
        Some(SLOW_RESPONSE_TIMEOUT)
    } else {
        Some(RESPONSE_TIMEOUT)
    }
}

fn location_of(resp: &Response<Incoming>) -> String {
    resp.headers()
        .get(header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string()
}

impl WebDavBackend {
    async fn send(
        &self,
        op: &str,
        method: Method,
        url: &Url,
        headers: &[(HeaderName, String)],
        body: Body,
    ) -> Result<Response<Incoming>, AppError> {
        let mut req = Request::builder()
            .method(method)
            .uri(url.as_str())
            .header(header::AUTHORIZATION, self.auth.clone());
        for (name, value) in headers {
            req = req.header(name, value);
        }
        let req = req
            .body(body)
            .map_err(|e| AppError::from(format!("{op}: {e}")))?;
        let window = response_window(req.method());
        let response = async {
            self.client
                .request(req)
                .await
                .map_err(|e| transport_error(op, &e))
        };
        match window {
            None => response.await,
            Some(window) => self.connector.bounded(op, window, response).await,
        }
    }

    async fn expect_ok(
        &self,
        op: &str,
        method: Method,
        url: &Url,
        headers: &[(HeaderName, String)],
        body: Body,
    ) -> Result<Response<Incoming>, AppError> {
        let resp = self.send(op, method, url, headers, body).await?;
        if resp.status() == StatusCode::MULTI_STATUS {
            Err(format!("{op} partially failed: some items could not be changed").into())
        } else if resp.status().is_success() {
            Ok(resp)
        } else {
            Err(status_error(op, resp.status()))
        }
    }

    async fn send_propfind(
        &self,
        op: &str,
        url: &Url,
        depth: &'static str,
    ) -> Result<Response<Incoming>, AppError> {
        self.send(
            op,
            method("PROPFIND"),
            url,
            &propfind_headers(depth),
            full(PROPFIND_BODY),
        )
        .await
    }

    /// None when the server answers 404; one same-origin redirect (Apache's missing `/`) is followed.
    async fn propfind(
        &self,
        url: &Url,
        depth: &'static str,
    ) -> Result<Option<Vec<DavEntry>>, AppError> {
        let mut resp = self.send_propfind("List", url, depth).await?;
        if resp.status().is_redirection() {
            let next = same_origin_join(url, &location_of(&resp))
                .ok_or_else(|| status_error("List", resp.status()))?;
            resp = self.send_propfind("List", &next, depth).await?;
        }
        match resp.status() {
            StatusCode::NOT_FOUND => Ok(None),
            _ => self.multistatus("List", resp).await.map(Some),
        }
    }

    async fn multistatus(
        &self,
        op: &str,
        resp: Response<Incoming>,
    ) -> Result<Vec<DavEntry>, AppError> {
        if resp.status() != StatusCode::MULTI_STATUS {
            return Err(status_error(op, resp.status()));
        }
        let body = async {
            resp.into_body()
                .collect()
                .await
                .map_err(|e| transport_error(op, &e))
        };
        let bytes = self
            .connector
            .bounded(op, RESPONSE_TIMEOUT, body)
            .await?
            .to_bytes();
        Ok(multistatus::parse(&String::from_utf8_lossy(&bytes))?)
    }

    /// Each entry with its path under the base; a listing none of whose entries lies
    /// under the base is an error, not an empty folder.
    fn located(&self, entries: Vec<DavEntry>) -> Result<Vec<(String, DavEntry)>, AppError> {
        let any = !entries.is_empty();
        let located: Vec<_> = entries
            .into_iter()
            .filter_map(|e| Some((self.base.path_of(&e.href)?, e)))
            .collect();
        if any && located.is_empty() {
            return Err("The server returned entries outside the WebDAV folder".into());
        }
        Ok(located)
    }

    async fn stat_entry(&self, path: &str) -> Result<Option<DavEntry>, AppError> {
        let Some(entries) = self.propfind(&self.base.url_for(path), "0").await? else {
            return Ok(None);
        };
        let path = normalize(path);
        let mut located = self.located(entries)?;
        // Servers that renormalise Unicode names answer under a spelling that differs from the request.
        let i = located.iter().position(|(at, _)| *at == path).unwrap_or(0);
        Ok((i < located.len()).then(|| located.swap_remove(i).1))
    }

    /// Folders must be addressed with a trailing `/` (nginx refuses otherwise).
    async fn target_url(&self, path: &str) -> Result<Url, AppError> {
        Ok(match self.stat_entry(path).await? {
            Some(entry) if entry.is_dir => self.base.dir_url_for(path),
            _ => self.base.url_for(path),
        })
    }

    fn to_remote_files(
        &self,
        dir: &str,
        entries: Vec<DavEntry>,
    ) -> Result<Vec<RemoteFile>, AppError> {
        let dir = normalize(dir);
        let mut files: Vec<RemoteFile> = self
            .located(entries)?
            .into_iter()
            .filter_map(|(path, e)| {
                if path == dir {
                    return None;
                }
                let name = path
                    .rsplit('/')
                    .next()
                    .filter(|n| !n.is_empty())?
                    .to_string();
                Some(RemoteFile {
                    name,
                    path,
                    size: e.size.unwrap_or(0),
                    is_dir: e.is_dir,
                    is_symlink: false,
                    modified: e.modified,
                    permissions: None,
                })
            })
            .collect();
        sort_listing(&mut files);
        Ok(files)
    }
}

pub async fn connect(
    url: &str,
    username: &str,
    password: &str,
    proxy: Option<ProxySpec>,
    known_hosts: Arc<KnownHostsStore>,
    prompt: Option<ConflictPrompt>,
) -> Result<WebDavBackend, AppError> {
    let connector = DavConnector::new(proxy, known_hosts, prompt);
    let mut backend = WebDavBackend {
        client: Client::builder(TokioExecutor::new())
            .pool_idle_timeout(POOL_IDLE)
            .build(connector.clone()),
        connector,
        base: DavBase::parse(url)?,
        auth: basic_auth(username, password),
    };
    let mut resp = backend
        .send_propfind("Connect", backend.base.url(), "0")
        .await?;
    if resp.status().is_redirection() {
        let location = location_of(&resp);
        backend.base = backend
            .base
            .same_origin_redirect(&location)
            .ok_or_else(|| {
                AppError::from(format!(
                    "The server redirected to another address ({location}); use that URL instead"
                ))
            })?;
        resp = backend
            .send_propfind("Connect", backend.base.url(), "0")
            .await?;
    }
    let entries = backend.multistatus("Connect", resp).await?;
    let is_folder = backend
        .located(entries)?
        .iter()
        .any(|(path, e)| path == "/" && e.is_dir);
    if !is_folder {
        return Err("The URL is not a WebDAV folder".into());
    }
    backend.connector.stop_prompting().await;
    Ok(backend)
}

#[async_trait]
impl<E: TransferEvents> FileBackend<E> for WebDavBackend {
    async fn list_dir(&self, path: &str) -> Result<Vec<RemoteFile>, AppError> {
        let entries = self
            .propfind(&self.base.dir_url_for(path), "1")
            .await?
            .ok_or_else(|| status_error("List", StatusCode::NOT_FOUND))?;
        self.to_remote_files(path, entries)
    }

    async fn stat(&self, path: &str) -> Result<Option<bool>, String> {
        Ok(self.stat_entry(path).await?.map(|e| e.is_dir))
    }

    async fn canonicalize(&self, path: &str) -> Result<String, AppError> {
        Ok(normalize(path))
    }

    async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        let already_exists =
            |status| status_error_with("Create folder", status, Some(ErrorCode::AlreadyExists));
        // rclone answers 201 to MKCOL on an existing folder.
        if self.stat_entry(path).await?.is_some() {
            return Err(already_exists(StatusCode::METHOD_NOT_ALLOWED));
        }
        let url = self.base.dir_url_for(path);
        let resp = self
            .send("Create folder", method("MKCOL"), &url, &[], empty())
            .await?;
        let status = resp.status();
        match status {
            StatusCode::METHOD_NOT_ALLOWED => Err(already_exists(status)),
            status if status.is_success() => Ok(()),
            status => Err(status_error("Create folder", status)),
        }
    }

    async fn touch(&self, path: &str) -> Result<(), AppError> {
        self.expect_ok(
            "Create file",
            Method::PUT,
            &self.base.url_for(path),
            &[(header::CONTENT_LENGTH, "0".into())],
            empty(),
        )
        .await
        .map(|_| ())
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        let src = self.target_url(from).await?;
        let dst = if src.path().ends_with('/') {
            self.base.dir_url_for(to)
        } else {
            self.base.url_for(to)
        };
        let headers = [
            (HeaderName::from_static("destination"), dst.to_string()),
            (HeaderName::from_static("overwrite"), "F".to_string()),
        ];
        self.expect_ok("Rename", method("MOVE"), &src, &headers, empty())
            .await
            .map(|_| ())
    }

    async fn delete(&self, path: &str) -> Result<(), AppError> {
        let url = self.target_url(path).await?;
        self.expect_ok("Delete", Method::DELETE, &url, &[], empty())
            .await
            .map(|_| ())
    }

    async fn file_size(&self, path: &str) -> u64 {
        self.stat_entry(path)
            .await
            .ok()
            .flatten()
            .and_then(|e| e.size)
            .unwrap_or(0)
    }

    async fn read_file(&self, path: &str, max_bytes: u64) -> Result<Vec<u8>, String> {
        let resp = self
            .expect_ok("Read", Method::GET, &self.base.url_for(path), &[], empty())
            .await?;
        read_capped(body_reader(resp), max_bytes)
            .await
            .map_err(|e| format!("read failed: {e}"))
    }

    async fn write_file(&self, path: &str, content: &str) -> Result<(), String> {
        let headers = [(header::CONTENT_LENGTH, content.len().to_string())];
        self.expect_ok(
            "Write",
            Method::PUT,
            &self.base.url_for(path),
            &headers,
            full(content.to_owned()),
        )
        .await
        .map(|_| ())
        .map_err(Into::into)
    }

    async fn upload_file(
        &self,
        app: &E,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        let mut local = tokio::fs::File::open(local_path)
            .await
            .map_err(|e| format!("Cannot open local file: {e}"))?;
        let total = local.metadata().await.map(|m| m.len()).unwrap_or(0);
        let (mut tx, rx) = tokio::io::duplex(UPLOAD_PIPE);
        let body = StreamBody::new(ReaderStream::new(rx).map_ok(Frame::data)).boxed();
        // nginx's dav module answers 411 to a chunked PUT, so the length is always sent.
        let headers = [(header::CONTENT_LENGTH, total.to_string())];
        let url = self.base.url_for(remote_path);
        let put = self.expect_ok("Upload", Method::PUT, &url, &headers, body);
        let pump = async move {
            let mut transferred = 0u64;
            pump_chunks(
                app,
                &mut local,
                &mut tx,
                transfer_id,
                token,
                &mut transferred,
                total,
            )
            .await
        };
        tokio::pin!(put, pump);
        tokio::select! {
            biased;
            early = &mut put => match early {
                Err(e) => Err(e.into()),
                Ok(_) => pump.await,
            },
            result = &mut pump => match result {
                Err(e) if token.is_cancelled() => Err(e),
                // The server's refusal can land just after the broken pipe it causes.
                Err(e) => match tokio::time::timeout(REFUSAL_GRACE, &mut put).await {
                    Ok(Err(refused)) => Err(refused.into()),
                    _ => Err(e),
                },
                Ok(()) => put.await.map(|_| ()).map_err(Into::into),
            },
        }
    }

    async fn download_file(
        &self,
        app: &E,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        token: &CancellationToken,
    ) -> Result<(), String> {
        if let Some(parent) = Path::new(local_path).parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Cannot create local dir: {e}"))?;
        }
        let resp = self
            .expect_ok(
                "Download",
                Method::GET,
                &self.base.url_for(remote_path),
                &[],
                empty(),
            )
            .await?;
        let total = resp
            .headers()
            .get(header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok()?.parse().ok())
            .unwrap_or(0);
        let mut local = tokio::fs::File::create(local_path)
            .await
            .map_err(|e| format!("Cannot create local file: {e}"))?;
        let mut reader = body_reader(resp);
        let mut transferred = 0u64;
        pump_chunks(
            app,
            &mut reader,
            &mut local,
            transfer_id,
            token,
            &mut transferred,
            total,
        )
        .await?;
        local.flush().await.ok();
        Ok(())
    }
}

#[cfg(test)]
mod test_server;

#[cfg(test)]
mod tests {
    use super::test_server::{canned, canned_early, canned_then_close, multistatus, reply};
    use super::*;
    use crate::error::ErrorCode;
    use crate::sftp::backend::test_tree::Recorder;

    const ROOT: &str = r#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>"#;
    const LISTING: &str = r#"<d:multistatus xmlns:d="DAV:">
      <d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
      <d:response><d:href>/dav/b%20file.txt</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>5</d:getcontentlength></d:prop></d:propstat></d:response>
      <d:response><d:href>/dav/Alpha/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
    </d:multistatus>"#;
    const FOLDER: &str = r#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/Alpha/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>"#;

    async fn backend(port: u16) -> Result<WebDavBackend, AppError> {
        connect(
            &format!("http://127.0.0.1:{port}/dav"),
            "u",
            "p",
            None,
            Arc::new(KnownHostsStore::new()),
            None,
        )
        .await
    }

    #[tokio::test]
    async fn connect_then_list_over_fresh_connections() {
        let (port, seen) = canned(vec![multistatus(ROOT), multistatus(LISTING)]).await;
        let b = backend(port).await.unwrap();
        let files = FileBackend::<Recorder>::list_dir(&b, "/").await.unwrap();
        let names: Vec<_> = files
            .iter()
            .map(|f| (f.name.as_str(), f.path.as_str(), f.is_dir))
            .collect();
        assert_eq!(
            names,
            [
                ("Alpha", "/Alpha", true),
                ("b file.txt", "/b file.txt", false)
            ]
        );
        let seen = seen.lock().unwrap();
        assert!(seen[0].head.starts_with("PROPFIND /dav/ HTTP/1.1"));
        assert!(seen[0]
            .head
            .to_ascii_lowercase()
            .contains("authorization: basic dtpw"));
        assert!(seen[1].head.to_ascii_lowercase().contains("depth: 1"));
    }

    #[tokio::test]
    async fn connect_reports_a_rejected_login() {
        let (port, _) = canned(vec![reply(
            "401 Unauthorized",
            "WWW-Authenticate: Basic\r\n",
            "",
        )])
        .await;
        let err = backend(port).await.err().unwrap();
        assert_eq!(err.code(), Some(ErrorCode::LoginRejected));
    }

    #[tokio::test]
    async fn connect_reports_a_missing_base_path() {
        let (port, _) = canned(vec![reply("404 Not Found", "", "")]).await;
        assert_eq!(
            backend(port).await.err().unwrap().code(),
            Some(ErrorCode::NotFound)
        );
    }

    #[tokio::test]
    async fn connect_follows_a_same_origin_redirect_once() {
        let unused = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let other = unused.local_addr().unwrap().port();
        drop(unused);
        let (port, seen) = canned(vec![reply(
            "301 Moved Permanently",
            &format!("Location: http://127.0.0.1:{other}/x/\r\n"),
            "",
        )])
        .await;
        let err = backend(port).await.err().unwrap();
        assert!(err.to_string().contains("redirected"), "{err}");
        assert_eq!(seen.lock().unwrap().len(), 1);

        let root2 = ROOT.replace("/dav/", "/dav2/");
        let (port, seen) = canned(vec![
            reply("301 Moved Permanently", "Location: /dav2/\r\n", ""),
            multistatus(&root2),
        ])
        .await;
        backend(port).await.unwrap();
        assert!(seen.lock().unwrap()[1]
            .head
            .starts_with("PROPFIND /dav2/ HTTP/1.1"));

        let (port, seen) = canned(vec![
            reply("301 Moved Permanently", "Location: /dav2/\r\n", ""),
            reply("301 Moved Permanently", "Location: /dav3/\r\n", ""),
            multistatus(&root2.replace("/dav2/", "/dav3/")),
        ])
        .await;
        let err = backend(port).await.err().unwrap();
        assert!(err.to_string().contains("HTTP 301"), "{err}");
        assert_eq!(seen.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn connect_requires_the_url_to_be_a_folder() {
        let file = ROOT.replace("<d:collection/>", "");
        let (port, _) = canned(vec![multistatus(&file)]).await;
        let err = backend(port).await.err().unwrap();
        assert!(err.to_string().contains("not a WebDAV folder"), "{err}");
    }

    #[test]
    fn only_deletes_and_moves_get_the_slow_window() {
        assert_eq!(response_window(&Method::GET), None);
        assert_eq!(response_window(&Method::PUT), None);
        assert_eq!(
            response_window(&Method::DELETE),
            Some(SLOW_RESPONSE_TIMEOUT)
        );
        assert_eq!(
            response_window(&method("MOVE")),
            Some(SLOW_RESPONSE_TIMEOUT)
        );
        assert_eq!(response_window(&method("PROPFIND")), Some(RESPONSE_TIMEOUT));
        assert_eq!(response_window(&method("MKCOL")), Some(RESPONSE_TIMEOUT));
    }

    #[tokio::test]
    async fn stat_ignores_an_entry_outside_the_base() {
        let mixed = r#"<d:multistatus xmlns:d="DAV:">
          <d:response><d:href>/other/Alpha</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
          <d:response><d:href>/dav/Alpha/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
        </d:multistatus>"#;
        let (port, _) = canned(vec![multistatus(ROOT), multistatus(mixed)]).await;
        let b = backend(port).await.unwrap();
        assert_eq!(
            FileBackend::<Recorder>::stat(&b, "/Alpha").await.unwrap(),
            Some(true)
        );
    }

    #[tokio::test]
    async fn a_listing_outside_the_base_is_an_error() {
        let elsewhere = LISTING.replace("/dav/", "/other/");
        let (port, _) = canned(vec![multistatus(ROOT), multistatus(&elsewhere)]).await;
        let b = backend(port).await.unwrap();
        let err = FileBackend::<Recorder>::list_dir(&b, "/")
            .await
            .err()
            .unwrap();
        assert!(
            err.to_string().contains("outside the WebDAV folder"),
            "{err}"
        );
    }

    #[tokio::test]
    async fn connect_times_out_when_the_server_never_answers() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (_tcp, _) = listener.accept().await.unwrap();
            std::future::pending::<()>().await;
        });
        let err = backend(port).await.err().unwrap();
        assert_eq!(err.code(), Some(ErrorCode::TimedOut), "{err}");
    }

    #[tokio::test]
    async fn deleting_a_folder_targets_its_slash_url() {
        let (port, seen) = canned(vec![
            multistatus(ROOT),
            multistatus(FOLDER),
            reply("204 No Content", "", ""),
        ])
        .await;
        let b = backend(port).await.unwrap();
        FileBackend::<Recorder>::delete(&b, "/Alpha").await.unwrap();
        assert!(seen.lock().unwrap()[2]
            .head
            .starts_with("DELETE /dav/Alpha/ HTTP/1.1"));
    }

    #[tokio::test]
    async fn rename_never_overwrites() {
        let (port, seen) = canned(vec![
            multistatus(ROOT),
            reply("404 Not Found", "", ""),
            reply("412 Precondition Failed", "", ""),
        ])
        .await;
        let b = backend(port).await.unwrap();
        let err = FileBackend::<Recorder>::rename(&b, "/a.txt", "/b c.txt")
            .await
            .unwrap_err();
        assert_eq!(err.code(), Some(ErrorCode::AlreadyExists));
        let head = seen.lock().unwrap()[2].head.to_ascii_lowercase();
        assert!(head.starts_with("move /dav/a.txt http/1.1"));
        assert!(head.contains(&format!(
            "destination: http://127.0.0.1:{port}/dav/b%20c.txt"
        )));
        assert!(head.contains("overwrite: f"));
    }

    #[tokio::test]
    async fn upload_streams_the_file_with_its_length_and_reports_progress() {
        let (port, seen) = canned(vec![multistatus(ROOT), reply("201 Created", "", "")]).await;
        let b = backend(port).await.unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let local = tmp.path().join("up.bin");
        std::fs::write(&local, b"hello webdav").unwrap();
        let events = Recorder::default();
        b.upload_file(
            &events,
            &local.to_string_lossy(),
            "/up.bin",
            "t1",
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        let seen = seen.lock().unwrap();
        assert!(seen[1].head.starts_with("PUT /dav/up.bin HTTP/1.1"));
        assert!(seen[1]
            .head
            .to_ascii_lowercase()
            .contains("content-length: 12"));
        assert_eq!(seen[1].body, b"hello webdav");
        assert!(events.count("sftp-progress-t1") >= 1);
    }

    #[tokio::test]
    async fn download_writes_the_body() {
        let (port, _) = canned(vec![multistatus(ROOT), reply("200 OK", "", "remote bytes")]).await;
        let b = backend(port).await.unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let local = tmp.path().join("d/out.txt");
        b.download_file(
            &Recorder::default(),
            "/x.txt",
            &local.to_string_lossy(),
            "t2",
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read_to_string(local).unwrap(), "remote bytes");
    }

    #[test]
    fn statuses_map_to_error_codes() {
        let code = |s: u16| status_error("Op", StatusCode::from_u16(s).unwrap()).code();
        assert_eq!(code(401), Some(ErrorCode::LoginRejected));
        assert_eq!(code(403), Some(ErrorCode::PermissionDenied));
        assert_eq!(code(404), Some(ErrorCode::NotFound));
        assert_eq!(code(405), None);
        assert_eq!(code(409), Some(ErrorCode::NotFound));
        assert_eq!(code(412), Some(ErrorCode::AlreadyExists));
        assert_eq!(code(423), Some(ErrorCode::ResourceLocked));
        assert_eq!(code(507), Some(ErrorCode::StorageFull));
        assert_eq!(code(500), None);
    }

    #[tokio::test]
    async fn upload_stops_when_the_server_refuses_early() {
        let (port, _) = canned_early(vec![
            multistatus(ROOT),
            reply("507 Insufficient Storage", "", ""),
        ])
        .await;
        let b = backend(port).await.unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let local = tmp.path().join("big.bin");
        std::fs::write(&local, vec![7u8; 32 * 1024 * 1024]).unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(10),
            b.upload_file(
                &Recorder::default(),
                &local.to_string_lossy(),
                "/big.bin",
                "t3",
                &CancellationToken::new(),
            ),
        )
        .await
        .expect("upload hung after the server refused it");
        let err = AppError::from(result.unwrap_err());
        assert!(err.to_string().contains("Upload failed: HTTP 507"), "{err}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_servers_refusal_wins_over_the_broken_pipe_it_causes() {
        let tmp = tempfile::tempdir().unwrap();
        let local = tmp.path().join("big.bin");
        std::fs::write(&local, vec![7u8; 8 * 1024 * 1024]).unwrap();
        for _ in 0..20 {
            let (port, _) = canned_then_close(vec![
                multistatus(ROOT),
                reply("507 Insufficient Storage", "", ""),
            ])
            .await;
            let b = backend(port).await.unwrap();
            let err = AppError::from(
                b.upload_file(
                    &Recorder::default(),
                    &local.to_string_lossy(),
                    "/big.bin",
                    "t4",
                    &CancellationToken::new(),
                )
                .await
                .unwrap_err(),
            );
            assert!(err.to_string().contains("Upload failed: HTTP 507"), "{err}");
        }
    }

    #[tokio::test]
    async fn mkdir_maps_405_to_already_exists() {
        let (port, _) = canned(vec![
            multistatus(ROOT),
            reply("404 Not Found", "", ""),
            reply("405 Method Not Allowed", "", ""),
        ])
        .await;
        let b = backend(port).await.unwrap();
        let err = FileBackend::<Recorder>::mkdir(&b, "/Alpha")
            .await
            .unwrap_err();
        assert_eq!(err.code(), Some(ErrorCode::AlreadyExists));
    }

    #[tokio::test]
    async fn mkdir_on_an_existing_folder_never_sends_mkcol() {
        let (port, seen) = canned(vec![multistatus(ROOT), multistatus(FOLDER)]).await;
        let b = backend(port).await.unwrap();
        let err = FileBackend::<Recorder>::mkdir(&b, "/Alpha")
            .await
            .unwrap_err();
        assert_eq!(err.code(), Some(ErrorCode::AlreadyExists));
        assert_eq!(seen.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_partial_207_on_delete_is_an_error() {
        let (port, _) = canned(vec![
            multistatus(ROOT),
            multistatus(FOLDER),
            multistatus(ROOT),
        ])
        .await;
        let b = backend(port).await.unwrap();
        let err = FileBackend::<Recorder>::delete(&b, "/Alpha")
            .await
            .unwrap_err();
        assert!(err.to_string().contains("partially failed"), "{err}");
    }

    #[tokio::test]
    async fn list_follows_a_same_origin_redirect_and_refuses_a_foreign_one() {
        let (port, seen) = canned(vec![
            multistatus(ROOT),
            reply("301 Moved Permanently", "Location: /dav/Alpha/\r\n", ""),
            multistatus(LISTING),
        ])
        .await;
        let b = backend(port).await.unwrap();
        FileBackend::<Recorder>::list_dir(&b, "/Alpha")
            .await
            .unwrap();
        assert!(seen.lock().unwrap()[2]
            .head
            .starts_with("PROPFIND /dav/Alpha/ HTTP/1.1"));

        let (port, seen) = canned(vec![
            multistatus(ROOT),
            reply(
                "301 Moved Permanently",
                "Location: http://example.invalid/x/\r\n",
                "",
            ),
        ])
        .await;
        let b = backend(port).await.unwrap();
        assert!(FileBackend::<Recorder>::list_dir(&b, "/Alpha")
            .await
            .is_err());
        assert_eq!(seen.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_connection_closed_before_any_response_is_connection_lost() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let (mut tcp, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 4096];
            let _ = tcp.read(&mut buf).await;
        });
        let err = backend(port).await.err().unwrap();
        assert_eq!(err.code(), Some(ErrorCode::ConnectionLost), "{err}");
    }

    #[tokio::test]
    async fn an_unreachable_proxy_is_named_in_the_error() {
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let proxy_port = closed.local_addr().unwrap().port();
        drop(closed);
        let proxy = ProxySpec::Http(crate::proxy::ProxyEndpoint {
            host: "127.0.0.1".into(),
            port: proxy_port,
            username: None,
            password: None,
        });
        let err = connect(
            "http://127.0.0.1:1/dav/",
            "u",
            "p",
            Some(proxy),
            Arc::new(KnownHostsStore::new()),
            None,
        )
        .await
        .err()
        .unwrap();
        assert_eq!(err.code(), Some(ErrorCode::ConnectionRefused), "{err}");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(
            json["params"]["proxy"],
            format!("127.0.0.1:{proxy_port}"),
            "{json}"
        );
    }

    // rclone serve webdav <root> --addr 127.0.0.1:8090 --user u --pass p
    // WEBDAV_TEST_URL=http://127.0.0.1:8090/ cargo test --lib webdav::tests::real_server_contract -- --ignored
    #[tokio::test]
    #[ignore]
    async fn real_server_contract() {
        let url = std::env::var("WEBDAV_TEST_URL").expect("WEBDAV_TEST_URL");
        let b = connect(&url, "u", "p", None, Arc::new(KnownHostsStore::new()), None)
            .await
            .unwrap();
        let events = Recorder::default();
        let token = CancellationToken::new();
        let fb: &dyn FileBackend<Recorder> = &b;

        fb.mkdir("/t dir").await.unwrap();
        assert_eq!(
            fb.mkdir("/t dir").await.unwrap_err().code(),
            Some(ErrorCode::AlreadyExists)
        );
        fb.write_file("/t dir/a #1.txt", "hello").await.unwrap();
        assert_eq!(fb.read_file("/t dir/a #1.txt", 3).await.unwrap(), b"hell");
        assert_eq!(fb.file_size("/t dir/a #1.txt").await, 5);
        let listed = fb.list_dir("/t dir").await.unwrap();
        assert_eq!(
            listed.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(),
            ["/t dir/a #1.txt"]
        );

        let tmp = tempfile::tempdir().unwrap();
        let big = tmp.path().join("big.bin");
        std::fs::write(&big, vec![7u8; 3 * 1024 * 1024]).unwrap();
        fb.upload_file(
            &events,
            &big.to_string_lossy(),
            "/t dir/big.bin",
            "u1",
            &token,
        )
        .await
        .unwrap();
        assert_eq!(fb.file_size("/t dir/big.bin").await, 3 * 1024 * 1024);

        let cancelled = CancellationToken::new();
        cancelled.cancel();
        assert!(fb
            .upload_file(
                &events,
                &big.to_string_lossy(),
                "/t dir/c.bin",
                "u2",
                &cancelled
            )
            .await
            .is_err());
        assert!(fb.stat("/t dir").await.unwrap().unwrap());

        let out = tmp.path().join("down.bin");
        fb.download_file(
            &events,
            "/t dir/big.bin",
            &out.to_string_lossy(),
            "d1",
            &token,
        )
        .await
        .unwrap();
        assert_eq!(std::fs::metadata(&out).unwrap().len(), 3 * 1024 * 1024);

        fb.write_file("/t dir/b.txt", "x").await.unwrap();
        assert_eq!(
            fb.rename("/t dir/a #1.txt", "/t dir/b.txt")
                .await
                .unwrap_err()
                .code(),
            Some(ErrorCode::AlreadyExists)
        );
        fb.rename("/t dir", "/t dir 2").await.unwrap();
        fb.delete("/t dir 2").await.unwrap();
        assert_eq!(fb.stat("/t dir 2").await.unwrap(), None);
    }
}
