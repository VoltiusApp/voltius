use crate::error::{AppError, ErrorCode};
use crate::known_hosts::{ConflictPrompt, KnownHostsStore};
use crate::proxy::{self, ProxiedStream, ProxySpec};
use crate::tls::{root_store, PinningVerifier, TLS_PIN_PREFIX, TLS_WEBPKI_MARKER};
use hyper::Uri;
use hyper_util::client::legacy::connect::{Connected, Connection};
use hyper_util::rt::TokioIo;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};
use tokio_rustls::client::TlsStream;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::rustls::RootCertStore;
use tokio_rustls::TlsConnector;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(not(test))]
pub const RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(test)]
pub const RESPONSE_TIMEOUT: Duration = Duration::from_secs(2);
pub const SLOW_RESPONSE_TIMEOUT: Duration = Duration::from_secs(600);

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
    policy: Mutex<PinPolicy>,
    roots: Option<Arc<RootCertStore>>,
    /// Bumped when a certificate prompt opens and when it closes: odd while one is open.
    prompt_epoch: AtomicU64,
}

struct PromptOpen<'a>(&'a AtomicU64);

impl<'a> PromptOpen<'a> {
    fn new(epoch: &'a AtomicU64) -> Self {
        epoch.fetch_add(1, Ordering::SeqCst);
        Self(epoch)
    }
}

impl Drop for PromptOpen<'_> {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

enum PinPolicy {
    Probing(Option<ConflictPrompt>),
    Stopped,
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
        Self::trusting(proxy, known_hosts, prompt, None)
    }

    /// `roots`: None trusts the system store.
    fn trusting(
        proxy: Option<ProxySpec>,
        known_hosts: Arc<KnownHostsStore>,
        prompt: Option<ConflictPrompt>,
        roots: Option<Arc<RootCertStore>>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                proxy,
                known_hosts,
                policy: Mutex::new(PinPolicy::Probing(prompt)),
                roots,
                prompt_epoch: AtomicU64::new(0),
            }),
        }
    }

    /// After the connect probe no new certificate is trusted, only already pinned ones.
    pub async fn stop_prompting(&self) {
        *self.inner.policy.lock().await = PinPolicy::Stopped;
    }

    /// Bounds a request's wait for an answer; time spent on a certificate prompt does not count.
    pub async fn bounded<T>(
        &self,
        op: &str,
        window: Duration,
        request: impl Future<Output = Result<T, AppError>>,
    ) -> Result<T, AppError> {
        tokio::pin!(request);
        let epoch_now = || self.inner.prompt_epoch.load(Ordering::SeqCst);
        loop {
            let epoch = epoch_now();
            match timeout(window, &mut request).await {
                Ok(result) => return result,
                Err(_) if epoch % 2 == 1 || epoch_now() != epoch => {}
                Err(_) => {
                    return Err(AppError::coded(
                        ErrorCode::TimedOut,
                        format!(
                            "{op} failed: the server did not answer within {} s",
                            window.as_secs()
                        ),
                    ))
                }
            }
        }
    }

    async fn open(&self, uri: Uri) -> io::Result<DavIo> {
        let inner = &self.inner;
        let (https, host, port) = endpoint(&uri)?;
        let stream = dial(inner, &host, port).await?;
        if !https {
            return Ok(DavIo::Plain(stream));
        }
        let pins: Vec<String> = inner
            .known_hosts
            .fingerprints_for(&host, port)
            .await
            .into_iter()
            .filter(|fp| fp.starts_with(TLS_PIN_PREFIX))
            .collect();
        let fp = match handshake(inner, &host, stream, pins).await {
            Ok((tls, ca_verified)) => {
                if ca_verified {
                    inner
                        .known_hosts
                        .add_once(&host, port, TLS_WEBPKI_MARKER)
                        .await;
                }
                return Ok(DavIo::Tls(Box::new(tls)));
            }
            Err((err, None)) => return Err(err),
            Err((_, Some(fp))) => fp,
        };
        match &*inner.policy.lock().await {
            PinPolicy::Stopped => {
                return Err(io::Error::other(format!(
                    "The certificate of {host}:{port} is not trusted. Reconnect to review it."
                )))
            }
            PinPolicy::Probing(prompt) => {
                let _open = PromptOpen::new(&inner.prompt_epoch);
                inner
                    .known_hosts
                    .verify_or_prompt(&host, port, fp.clone(), prompt.as_ref())
                    .await
                    .map_err(io::Error::other)?
            }
        }
        let stream = dial(inner, &host, port).await?;
        handshake(inner, &host, stream, vec![fp])
            .await
            .map(|(tls, _)| DavIo::Tls(Box::new(tls)))
            .map_err(|(err, _)| err)
    }
}

/// `(https, host, port)`, the host without IPv6 brackets.
fn endpoint(uri: &Uri) -> io::Result<(bool, String, u16)> {
    let https = match uri.scheme_str() {
        Some("https") => true,
        Some("http") => false,
        other => {
            return Err(io::Error::other(format!(
                "unsupported URL scheme {other:?}"
            )))
        }
    };
    let host = uri
        .host()
        .ok_or_else(|| io::Error::other("URL has no host"))?
        .trim_matches(['[', ']'])
        .to_string();
    let port = uri.port_u16().unwrap_or(if https { 443 } else { 80 });
    Ok((https, host, port))
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
        Ok(Err(e)) => Err(io::Error::other(e)),
        Ok(Ok(dialed)) => Ok(dialed.stream),
    }
}

/// Ok tells whether a CA vouched for the certificate; Err carries the refused
/// certificate's fingerprint when only the pin check failed.
async fn handshake(
    inner: &Inner,
    host: &str,
    stream: ProxiedStream,
    pins: Vec<String>,
) -> Result<(TlsStream<ProxiedStream>, bool), (io::Error, Option<String>)> {
    let setup = |e: String| (io::Error::other(e), None);
    let roots = match &inner.roots {
        Some(roots) => Arc::clone(roots),
        None => root_store().map_err(setup)?,
    };
    let verifier = PinningVerifier::new(roots, pins).map_err(setup)?;
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
        Ok(Ok(tls)) => Ok((tls, verifier.accepted_by_webpki())),
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
    use crate::known_hosts::{answering, ConflictAction, HostKeyConflictEvent};
    use crate::tls::pin_tests::{ca_signed, self_signed, serve_tls};
    use crate::tls::tls_fingerprint;

    fn connector(store: &Arc<KnownHostsStore>, prompt: Option<ConflictPrompt>) -> DavConnector {
        DavConnector::new(None, Arc::clone(store), prompt)
    }

    fn uri(port: u16) -> Uri {
        format!("https://127.0.0.1:{port}/").parse().unwrap()
    }

    fn replacing() -> ConflictPrompt {
        answering(|| ConflictAction::Replace, Arc::default())
    }

    #[tokio::test]
    async fn a_new_self_signed_server_is_pinned_and_connected() {
        let leaf = self_signed();
        let port = serve_tls(&leaf).await;
        let store = Arc::new(KnownHostsStore::new());
        let io = connector(&store, None).open(uri(port)).await.unwrap();
        assert!(matches!(io, DavIo::Tls(_)));
        let pins = store.fingerprints_for("127.0.0.1", port).await;
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
        let pins = store.fingerprints_for("127.0.0.1", port).await;
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
        assert!(err.to_string().contains("not trusted"), "{err}");
    }

    #[tokio::test]
    async fn an_unpinned_certificate_after_connect_is_refused_and_not_pinned() {
        let leaf = self_signed();
        let port = serve_tls(&leaf).await;
        let store = Arc::new(KnownHostsStore::new());
        let c = connector(&store, None);
        c.stop_prompting().await;
        let err = tokio::time::timeout(Duration::from_secs(5), c.open(uri(port)))
            .await
            .expect("must not wait on a prompt")
            .err()
            .expect("must be refused");
        assert!(err.to_string().contains("not trusted"), "{err}");
        assert!(store.fingerprints_for("127.0.0.1", port).await.is_empty());
    }

    fn marked(port: u16) -> Arc<KnownHostsStore> {
        Arc::new(KnownHostsStore::pinned(&[(
            "127.0.0.1",
            port,
            TLS_WEBPKI_MARKER,
        )]))
    }

    #[tokio::test]
    async fn a_ca_signed_server_is_remembered_once() {
        let (leaf, ca) = ca_signed();
        let port = serve_tls(&leaf).await;
        let mut roots = RootCertStore::empty();
        roots.add(ca).unwrap();
        let store = Arc::new(KnownHostsStore::new());
        let c = DavConnector::trusting(None, Arc::clone(&store), None, Some(Arc::new(roots)));
        c.open(uri(port)).await.unwrap();
        c.open(uri(port)).await.unwrap();
        let entries = store.fingerprints_for("127.0.0.1", port).await;
        assert_eq!(entries, [TLS_WEBPKI_MARKER]);
    }

    #[tokio::test]
    async fn a_self_signed_certificate_on_a_ca_host_is_refused_without_a_prompt() {
        let leaf = self_signed();
        let port = serve_tls(&leaf).await;
        let store = marked(port);
        let err = connector(&store, None).open(uri(port)).await.err().unwrap();
        assert!(err.to_string().contains("Host key changed for"), "{err}");
        let entries = store.fingerprints_for("127.0.0.1", port).await;
        assert_eq!(entries, [TLS_WEBPKI_MARKER]);
    }

    #[tokio::test]
    async fn replacing_a_ca_host_with_a_self_signed_certificate_supersedes_the_marker() {
        let leaf = self_signed();
        let port = serve_tls(&leaf).await;
        let store = marked(port);
        connector(&store, Some(replacing()))
            .open(uri(port))
            .await
            .unwrap();
        let entries = store.fingerprints_for("127.0.0.1", port).await;
        assert_eq!(entries, [tls_fingerprint(&leaf.cert)]);
    }

    #[test]
    fn endpoints_default_their_port_and_unbracket_ipv6() {
        let of = |raw: &str| endpoint(&raw.parse().unwrap()).unwrap();
        assert_eq!(of("https://[::1]:8443/"), (true, "::1".into(), 8443));
        assert_eq!(of("https://h/dav/"), (true, "h".into(), 443));
        assert_eq!(of("http://h/dav/"), (false, "h".into(), 80));
    }

    #[tokio::test]
    async fn a_request_that_never_answers_times_out() {
        let c = connector(&Arc::new(KnownHostsStore::new()), None);
        let err = c
            .bounded(
                "List",
                RESPONSE_TIMEOUT,
                std::future::pending::<Result<(), AppError>>(),
            )
            .await
            .unwrap_err();
        assert_eq!(err.code(), Some(ErrorCode::TimedOut), "{err}");
    }

    fn slow(prompt: ConflictPrompt, delay: Duration) -> ConflictPrompt {
        let answer: Arc<dyn Fn(HostKeyConflictEvent) + Send + Sync> = Arc::from(prompt.emit);
        ConflictPrompt {
            emit: Box::new(move |event| {
                let answer = Arc::clone(&answer);
                tokio::spawn(async move {
                    tokio::time::sleep(delay).await;
                    answer(event);
                });
            }),
            ..prompt
        }
    }

    #[tokio::test]
    async fn time_on_a_certificate_prompt_is_not_a_timeout() {
        let leaf = self_signed();
        let port = serve_tls(&leaf).await;
        let store = marked(port);
        let c = connector(&store, Some(slow(replacing(), RESPONSE_TIMEOUT * 2)));
        c.bounded("Connect", RESPONSE_TIMEOUT, async {
            c.open(uri(port))
                .await
                .map_err(|e| AppError::caused("Connect", &e))
        })
        .await
        .unwrap();
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
