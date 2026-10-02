use crate::known_hosts::{ConflictPrompt, KnownHostsStore};
use crate::proxy::{self, ProxiedStream, ProxyError, ProxySpec};
use crate::tls::{root_store, PinningVerifier, TLS_PIN_PREFIX};
use hyper::Uri;
use hyper_util::client::legacy::connect::{Connected, Connection};
use hyper_util::rt::TokioIo;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};
use tokio_rustls::client::TlsStream;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::TlsConnector;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

pub enum DavIo {
    Plain(ProxiedStream),
    Tls(Box<TlsStream<ProxiedStream>>),
}

impl AsyncRead for DavIo {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.get_mut() {
            DavIo::Plain(s) => Pin::new(s).poll_read(cx, buf),
            DavIo::Tls(s) => Pin::new(s.as_mut()).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for DavIo {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        match self.get_mut() {
            DavIo::Plain(s) => Pin::new(s).poll_write(cx, buf),
            DavIo::Tls(s) => Pin::new(s.as_mut()).poll_write(cx, buf),
        }
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            DavIo::Plain(s) => Pin::new(s).poll_flush(cx),
            DavIo::Tls(s) => Pin::new(s.as_mut()).poll_flush(cx),
        }
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            DavIo::Plain(s) => Pin::new(s).poll_shutdown(cx),
            DavIo::Tls(s) => Pin::new(s.as_mut()).poll_shutdown(cx),
        }
    }
}

impl Connection for DavIo {
    fn connected(&self) -> Connected {
        Connected::new()
    }
}

struct Inner {
    proxy: Option<ProxySpec>,
    known_hosts: Arc<KnownHostsStore>,
    prompt: Mutex<Option<ConflictPrompt>>,
}

#[derive(Clone)]
pub struct DavConnector {
    inner: Arc<Inner>,
}

impl DavConnector {
    pub fn new(
        proxy: Option<ProxySpec>,
        known_hosts: Arc<KnownHostsStore>,
        prompt: Option<ConflictPrompt>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                proxy,
                known_hosts,
                prompt: Mutex::new(prompt),
            }),
        }
    }

    /// After the connect probe nobody shows a dialog, so a later change is refused.
    pub async fn stop_prompting(&self) {
        self.inner.prompt.lock().await.take();
    }

    async fn open(&self, uri: Uri) -> io::Result<DavIo> {
        let inner = &self.inner;
        let https = uri.scheme_str() == Some("https");
        let host = uri
            .host()
            .ok_or_else(|| io::Error::other("URL has no host"))?
            .trim_matches(['[', ']'])
            .to_string();
        let port = uri.port_u16().unwrap_or(if https { 443 } else { 80 });
        let stream = dial(inner, &host, port).await?;
        if !https {
            return Ok(DavIo::Plain(stream));
        }
        let pins: Vec<String> = inner
            .known_hosts
            .entries_for(&host, port)
            .await
            .into_iter()
            .map(|e| e.fingerprint)
            .filter(|fp| fp.starts_with(TLS_PIN_PREFIX))
            .collect();
        let fp = match handshake(&host, stream, pins).await {
            Ok(tls) => return Ok(DavIo::Tls(Box::new(tls))),
            Err((err, None)) => return Err(err),
            Err((_, Some(fp))) => fp,
        };
        {
            let prompt = inner.prompt.lock().await;
            inner
                .known_hosts
                .verify_or_prompt(&host, port, fp.clone(), prompt.as_ref())
                .await
                .map_err(io::Error::other)?;
        }
        let stream = dial(inner, &host, port).await?;
        handshake(&host, stream, vec![fp])
            .await
            .map(|tls| DavIo::Tls(Box::new(tls)))
            .map_err(|(err, _)| err)
    }
}

async fn dial(inner: &Inner, host: &str, port: u16) -> io::Result<ProxiedStream> {
    match timeout(
        CONNECT_TIMEOUT,
        proxy::dial(inner.proxy.as_ref(), host, port),
    )
    .await
    {
        Err(_) => Err(io::Error::new(
            io::ErrorKind::TimedOut,
            format!("{host}:{port} did not respond"),
        )),
        Ok(Err(e)) => Err(dial_error(e)),
        Ok(Ok(dialed)) => Ok(dialed.stream),
    }
}

fn dial_error(e: ProxyError) -> io::Error {
    let kind = match &e {
        ProxyError::Direct(io) | ProxyError::Unreachable { source: io, .. } => io.kind(),
        ProxyError::Timeout { .. } => io::ErrorKind::TimedOut,
        _ => io::ErrorKind::Other,
    };
    io::Error::new(kind, e.to_string())
}

/// Err carries the refused certificate's fingerprint when only the pin check failed.
async fn handshake(
    host: &str,
    stream: ProxiedStream,
    pins: Vec<String>,
) -> Result<TlsStream<ProxiedStream>, (io::Error, Option<String>)> {
    let setup = |e: String| (io::Error::other(e), None);
    let verifier = PinningVerifier::new(root_store().map_err(setup)?, pins).map_err(setup)?;
    let config = verifier.client_config().map_err(setup)?;
    let name = ServerName::try_from(host.to_string()).map_err(|e| setup(e.to_string()))?;
    match timeout(
        CONNECT_TIMEOUT,
        TlsConnector::from(config).connect(name, stream),
    )
    .await
    {
        Err(_) => Err((
            io::Error::new(io::ErrorKind::TimedOut, "TLS handshake timed out"),
            None,
        )),
        Ok(Ok(tls)) => Ok(tls),
        Ok(Err(e)) => Err((e, verifier.rejected_fingerprint())),
    }
}

impl tower_service::Service<Uri> for DavConnector {
    type Response = TokioIo<DavIo>;
    type Error = io::Error;
    type Future = Pin<Box<dyn Future<Output = io::Result<TokioIo<DavIo>>> + Send>>;

    fn poll_ready(&mut self, _: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, uri: Uri) -> Self::Future {
        let this = self.clone();
        Box::pin(async move { this.open(uri).await.map(TokioIo::new) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::known_hosts::{ConflictAction, PendingConflicts};
    use crate::tls::pin_tests::{self_signed, serve_tls};
    use crate::tls::tls_fingerprint;

    fn connector(store: &Arc<KnownHostsStore>, prompt: Option<ConflictPrompt>) -> DavConnector {
        DavConnector::new(None, Arc::clone(store), prompt)
    }

    fn uri(port: u16) -> Uri {
        format!("https://127.0.0.1:{port}/").parse().unwrap()
    }

    fn replacing() -> ConflictPrompt {
        let pending = Arc::new(PendingConflicts::new());
        let answer = Arc::clone(&pending);
        ConflictPrompt {
            session_id: "c1".into(),
            pending,
            emit: Box::new(move |event| {
                let tx = answer
                    .0
                    .try_lock()
                    .unwrap()
                    .remove(&event.session_id)
                    .unwrap();
                let _ = tx.send(ConflictAction::Replace);
            }),
        }
    }

    #[tokio::test]
    async fn a_new_self_signed_server_is_pinned_and_connected() {
        let leaf = self_signed();
        let port = serve_tls(&leaf).await;
        let store = Arc::new(KnownHostsStore::new());
        let io = connector(&store, None).open(uri(port)).await.unwrap();
        assert!(matches!(io, DavIo::Tls(_)));
        let pins: Vec<_> = store
            .entries_for("127.0.0.1", port)
            .await
            .into_iter()
            .map(|e| e.fingerprint)
            .collect();
        assert_eq!(pins, [tls_fingerprint(&leaf.cert)]);
    }

    #[tokio::test]
    async fn a_changed_certificate_is_replaced_after_asking() {
        let leaf = self_signed();
        let port = serve_tls(&leaf).await;
        let store = Arc::new(KnownHostsStore::pinned(&[(
            "127.0.0.1",
            port,
            "tls-sha256:00",
        )]));
        connector(&store, Some(replacing()))
            .open(uri(port))
            .await
            .unwrap();
        let pins: Vec<_> = store
            .entries_for("127.0.0.1", port)
            .await
            .into_iter()
            .map(|e| e.fingerprint)
            .collect();
        assert_eq!(pins, [tls_fingerprint(&leaf.cert)]);
    }

    #[tokio::test]
    async fn a_changed_certificate_after_connect_is_refused_without_prompting() {
        let leaf = self_signed();
        let port = serve_tls(&leaf).await;
        let store = Arc::new(KnownHostsStore::pinned(&[(
            "127.0.0.1",
            port,
            "tls-sha256:00",
        )]));
        let c = connector(&store, Some(replacing()));
        c.stop_prompting().await;
        let err = tokio::time::timeout(Duration::from_secs(5), c.open(uri(port)))
            .await
            .expect("must not wait on a prompt")
            .err()
            .expect("must be refused");
        assert!(err.to_string().contains("changed"), "{err}");
    }

    #[tokio::test]
    async fn plain_http_skips_tls() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = listener.accept().await;
        });
        let store = Arc::new(KnownHostsStore::new());
        let io = connector(&store, None)
            .open(format!("http://127.0.0.1:{port}/").parse().unwrap())
            .await
            .unwrap();
        assert!(matches!(io, DavIo::Plain(_)));
    }
}
