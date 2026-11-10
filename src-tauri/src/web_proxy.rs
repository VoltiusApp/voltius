//! Local reverse proxy that lets a webview show an HTTPS host whose certificate no CA vouches for
//! (Proxmox, routers, NAS boxes: self-signed out of the box).
//!
//! A webview refuses such a page and exposes no way to accept it. So the page is loaded through
//! `http://127.0.0.1:<port>/`, and this proxy talks to the host with the same pinned-certificate
//! TLS as WebDAV: the first certificate seen is pinned (and listed under Known Hosts), a different
//! one afterwards is refused. A host with a certificate a CA vouches for is not proxied at all.
//!
//! Beyond forwarding, the proxy only rewrites what the move from `https://host:port` to
//! `http://127.0.0.1:<port>` breaks: `Secure`/`Domain` on cookies, `Location`, `Origin` and
//! `Referer`. WebSocket upgrades (consoles, terminals) are tunnelled. Page bodies are not touched.

use crate::error::AppError;
use crate::known_hosts::KnownHostsStore;
use crate::tls::TLS_WEBPKI_MARKER;
use crate::webdav::connector::DavConnector;
use bytes::Bytes;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Empty, Full};
use hyper::body::Incoming;
use hyper::header::{self, HeaderMap, HeaderName, HeaderValue};
use hyper::service::service_fn;
use hyper::upgrade::OnUpgrade;
use hyper::{Request, Response, StatusCode, Uri};
use hyper_util::client::legacy::Client;
use hyper_util::rt::{TokioExecutor, TokioIo};
use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::hash::{Hash, Hasher};
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tower_service::Service;
use url::{Position, Url};

type ProxyBody = BoxBody<Bytes, hyper::Error>;

// Below the 5 s keep-alive common servers use, so a pooled connection is dropped before the
// server closes it (same reasoning as the WebDAV client).
const POOL_IDLE: Duration = Duration::from_secs(4);

/// The proxies in use, one per pane or window. Managed Tauri state.
#[derive(Default)]
pub struct WebProxies {
    /// By upstream `host:port`: panes and windows showing the same host share one proxy.
    running: Mutex<HashMap<String, Running>>,
}

struct Running {
    /// `http://127.0.0.1:<port>`
    origin: String,
    stop: CancellationToken,
    /// The panes and windows (`resolve` keys) using it; it stops with the last one.
    users: HashSet<String>,
}

impl WebProxies {
    /// The address a webview should load for `url`, under the name `key`: `url` itself when it is
    /// plain HTTP or a CA vouches for the host, otherwise a local proxy to it (started on first use).
    pub async fn resolve(
        &self,
        key: &str,
        url: &str,
        known_hosts: Arc<KnownHostsStore>,
    ) -> Result<String, AppError> {
        let parsed = Url::parse(url).map_err(|e| AppError::from(format!("Invalid URL: {e}")))?;
        if parsed.scheme() != "https" {
            return Ok(url.to_string());
        }
        let shown_host = parsed
            .host_str()
            .ok_or_else(|| AppError::from("The address has no host"))?
            .to_string();
        let host = shown_host.trim_matches(['[', ']']).to_string();
        let port = parsed.port_or_known_default().unwrap_or(443);
        let rest = parsed[Position::BeforePath..].to_string();

        let authority = format!("{shown_host}:{port}");
        if let Some(running) = self.running.lock().await.get_mut(&authority) {
            running.users.insert(key.to_string());
            return Ok(format!("{}{rest}", running.origin));
        }

        let connector = DavConnector::new(None, Arc::clone(&known_hosts), None);
        let probe: Uri = format!("https://{authority}/")
            .parse()
            .map_err(|e| AppError::from(format!("Invalid address: {e}")))?;
        connector
            .clone()
            .call(probe)
            .await
            .map_err(|e| AppError::from(format!("Could not connect to {host}:{port}: {e}")))?;
        let ca_vouches = known_hosts
            .fingerprints_for(&host, port)
            .await
            .iter()
            .any(|fp| fp == TLS_WEBPKI_MARKER);
        if ca_vouches {
            return Ok(url.to_string());
        }

        // The same host gets the same local port every time (a webview's storage, such as
        // Proxmox's CSRF token, is per origin), unless something else holds it.
        let listener = match TcpListener::bind((Ipv4Addr::LOCALHOST, stable_port(&authority))).await
        {
            Ok(listener) => listener,
            Err(_) => TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
                .await
                .map_err(|e| AppError::from(format!("Could not start the local proxy: {e}")))?,
        };
        let local_port = listener
            .local_addr()
            .map_err(|e| AppError::from(format!("Could not start the local proxy: {e}")))?
            .port();
        let upstream = Arc::new(Upstream::new(&shown_host, port, local_port, connector));
        let origin = upstream.local_origin.clone();
        let stop = CancellationToken::new();
        tokio::spawn(serve(listener, upstream, stop.clone()));
        self.running.lock().await.insert(
            authority,
            Running {
                origin: origin.clone(),
                stop,
                users: HashSet::from([key.to_string()]),
            },
        );
        Ok(format!("{origin}{rest}"))
    }

    /// Stop the proxy named `key`, if any.
    pub async fn stop(&self, key: &str) {
        let mut running = self.running.lock().await;
        for entry in running.values_mut() {
            entry.users.remove(key);
        }
        running.retain(|_, entry| {
            let keep = !entry.users.is_empty();
            if !keep {
                entry.stop.cancel();
            }
            keep
        });
    }
}

/// A fixed port in the dynamic range for an upstream, so reopening a host keeps its origin.
fn stable_port(authority: &str) -> u16 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    authority.hash(&mut hasher);
    49152 + (hasher.finish() % 16000) as u16
}

struct Upstream {
    /// `host:port` as in a URI, an IPv6 host bracketed.
    authority: String,
    /// The forms `https://host:port` takes in a `Location`; the port may be dropped when it is 443.
    upstream_prefixes: Vec<String>,
    local_origin: String,
    local_authority: String,
    connector: DavConnector,
    client: Client<DavConnector, ProxyBody>,
}

impl Upstream {
    fn new(shown_host: &str, port: u16, local_port: u16, connector: DavConnector) -> Self {
        let mut upstream_prefixes = vec![format!("https://{shown_host}:{port}")];
        if port == 443 {
            upstream_prefixes.push(format!("https://{shown_host}"));
        }
        Self {
            authority: format!("{shown_host}:{port}"),
            upstream_prefixes,
            local_origin: format!("http://127.0.0.1:{local_port}"),
            local_authority: format!("127.0.0.1:{local_port}"),
            client: Client::builder(TokioExecutor::new())
                .pool_idle_timeout(POOL_IDLE)
                .build(connector.clone()),
            connector,
        }
    }

    fn upstream_origin(&self) -> &str {
        &self.upstream_prefixes[0]
    }
}

async fn serve(listener: TcpListener, upstream: Arc<Upstream>, stop: CancellationToken) {
    loop {
        tokio::select! {
            _ = stop.cancelled() => break,
            accepted = listener.accept() => {
                let Ok((stream, _)) = accepted else { continue };
                let upstream = Arc::clone(&upstream);
                let stop = stop.clone();
                tokio::spawn(async move {
                    let service = service_fn(move |req| handle(Arc::clone(&upstream), req));
                    let connection = hyper::server::conn::http1::Builder::new()
                        .serve_connection(TokioIo::new(stream), service)
                        .with_upgrades();
                    tokio::pin!(connection);
                    tokio::select! {
                        _ = connection.as_mut() => {}
                        _ = stop.cancelled() => {}
                    }
                });
            }
        }
    }
}

async fn handle(
    upstream: Arc<Upstream>,
    req: Request<Incoming>,
) -> Result<Response<ProxyBody>, Infallible> {
    Ok(match forward(&upstream, req).await {
        Ok(resp) => resp,
        Err(message) => plain(
            StatusCode::BAD_GATEWAY,
            format!(
                "Voltius could not reach {}.\n\n{message}",
                upstream.authority
            ),
        ),
    })
}

async fn forward(
    upstream: &Upstream,
    mut req: Request<Incoming>,
) -> Result<Response<ProxyBody>, String> {
    // Only the webview's own address is served: a page on another name pointed at 127.0.0.1
    // (DNS rebinding) must not reach the host through here.
    let host_ok = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| h == upstream.local_authority);
    if !host_ok {
        return Ok(plain(StatusCode::FORBIDDEN, "Unexpected Host header"));
    }

    let upgrading = is_upgrade(req.headers());
    let client_upgrade: Option<OnUpgrade> = upgrading.then(|| hyper::upgrade::on(&mut req));
    let (parts, body) = req.into_parts();

    let path = parts.uri.path_and_query().map_or("/", |p| p.as_str());
    let uri: Uri = format!("https://{}{path}", upstream.authority)
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?;
    let mut headers = HeaderMap::with_capacity(parts.headers.len());
    for (name, value) in &parts.headers {
        if *name == header::HOST || (is_hop_by_hop(name) && !(upgrading && keeps_for_upgrade(name)))
        {
            continue;
        }
        headers.append(name.clone(), rewrite_request_value(upstream, name, value));
    }

    if let Some(client_upgrade) = client_upgrade {
        let mut request = Request::new(Empty::<Bytes>::new());
        *request.method_mut() = parts.method;
        *request.uri_mut() = uri.clone();
        *request.headers_mut() = headers;
        return tunnel(upstream, uri, request, client_upgrade).await;
    }

    let mut request = Request::new(body.boxed());
    *request.method_mut() = parts.method;
    *request.uri_mut() = uri;
    *request.headers_mut() = headers;
    let resp = upstream
        .client
        .request(request)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rewrite_response(upstream, resp))
}

/// Forward a WebSocket (or other) upgrade and, once the host agrees, pipe the two sides together.
async fn tunnel(
    upstream: &Upstream,
    uri: Uri,
    request: Request<Empty<Bytes>>,
    client_upgrade: OnUpgrade,
) -> Result<Response<ProxyBody>, String> {
    let io = upstream
        .connector
        .clone()
        .call(uri)
        .await
        .map_err(|e| e.to_string())?;
    let (mut sender, connection) = hyper::client::conn::http1::handshake(io)
        .await
        .map_err(|e| e.to_string())?;
    tokio::spawn(async move {
        let _ = connection.with_upgrades().await;
    });
    let mut resp = sender
        .send_request(request)
        .await
        .map_err(|e| e.to_string())?;
    if resp.status() != StatusCode::SWITCHING_PROTOCOLS {
        return Ok(rewrite_response(upstream, resp));
    }

    let upstream_upgrade = hyper::upgrade::on(&mut resp);
    let (parts, _) = resp.into_parts();
    tokio::spawn(async move {
        if let (Ok(client), Ok(host)) = (client_upgrade.await, upstream_upgrade.await) {
            let (mut client, mut host) = (TokioIo::new(client), TokioIo::new(host));
            let _ = tokio::io::copy_bidirectional(&mut client, &mut host).await;
        }
    });
    let mut out = Response::new(empty());
    *out.status_mut() = StatusCode::SWITCHING_PROTOCOLS;
    *out.headers_mut() = parts.headers;
    Ok(out)
}

fn empty() -> ProxyBody {
    Empty::new().map_err(|never| match never {}).boxed()
}

fn plain(status: StatusCode, message: impl Into<Bytes>) -> Response<ProxyBody> {
    let mut resp = Response::new(
        Full::new(message.into())
            .map_err(|never| match never {})
            .boxed(),
    );
    *resp.status_mut() = status;
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    resp
}

fn is_upgrade(headers: &HeaderMap) -> bool {
    headers.contains_key(header::UPGRADE)
        && headers
            .get(header::CONNECTION)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.to_ascii_lowercase().contains("upgrade"))
}

fn is_hop_by_hop(name: &HeaderName) -> bool {
    *name == header::CONNECTION
        || name.as_str() == "keep-alive"
        || *name == header::PROXY_AUTHENTICATE
        || *name == header::PROXY_AUTHORIZATION
        || *name == header::TE
        || *name == header::TRAILER
        || *name == header::TRANSFER_ENCODING
        || *name == header::UPGRADE
}

/// The two hop-by-hop headers an upgrade is made of.
fn keeps_for_upgrade(name: &HeaderName) -> bool {
    *name == header::CONNECTION || *name == header::UPGRADE
}

/// `Origin` and `Referer` name the proxy's address; the host should see its own.
fn rewrite_request_value(
    upstream: &Upstream,
    name: &HeaderName,
    value: &HeaderValue,
) -> HeaderValue {
    if *name == header::ORIGIN || *name == header::REFERER {
        if let Some(rest) = value
            .to_str()
            .ok()
            .and_then(|text| text.strip_prefix(upstream.local_origin.as_str()))
        {
            if let Ok(rewritten) =
                HeaderValue::from_str(&format!("{}{rest}", upstream.upstream_origin()))
            {
                return rewritten;
            }
        }
    }
    value.clone()
}

fn rewrite_response(upstream: &Upstream, resp: Response<Incoming>) -> Response<ProxyBody> {
    let (mut parts, body) = resp.into_parts();
    let mut headers = HeaderMap::with_capacity(parts.headers.len());
    for (name, value) in &parts.headers {
        if is_hop_by_hop(name) || *name == header::STRICT_TRANSPORT_SECURITY {
            continue;
        }
        let value = if *name == header::SET_COOKIE {
            rewrite_set_cookie(value)
        } else if *name == header::LOCATION {
            rewrite_location(upstream, value)
        } else {
            value.clone()
        };
        headers.append(name.clone(), value);
    }
    parts.headers = headers;
    Response::from_parts(parts, body.boxed())
}

/// The cookie is now set by `http://127.0.0.1`: `Secure` would make the webview discard it, a
/// `Domain` would never match, and `SameSite=None` is only valid together with `Secure`.
fn rewrite_set_cookie(value: &HeaderValue) -> HeaderValue {
    let Ok(text) = value.to_str() else {
        return value.clone();
    };
    let kept: Vec<&str> = text
        .split(';')
        .map(str::trim)
        .filter(|attr| {
            !attr.eq_ignore_ascii_case("secure") && !starts_with_ignore_case(attr, "domain=")
        })
        .map(|attr| {
            if attr.eq_ignore_ascii_case("samesite=none") {
                "SameSite=Lax"
            } else {
                attr
            }
        })
        .collect();
    HeaderValue::from_str(&kept.join("; ")).unwrap_or_else(|_| value.clone())
}

fn starts_with_ignore_case(text: &str, prefix: &str) -> bool {
    text.get(..prefix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
}

/// A redirect to the host's own address becomes one to the proxy's.
fn rewrite_location(upstream: &Upstream, value: &HeaderValue) -> HeaderValue {
    let Ok(text) = value.to_str() else {
        return value.clone();
    };
    for prefix in &upstream.upstream_prefixes {
        let Some(rest) = text.strip_prefix(prefix.as_str()) else {
            continue;
        };
        if rest.is_empty() || rest.starts_with(['/', '?', '#']) {
            if let Ok(rewritten) =
                HeaderValue::from_str(&format!("{}{rest}", upstream.local_origin))
            {
                return rewritten;
            }
        }
    }
    value.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upstream(port: u16) -> Upstream {
        Upstream::new(
            "192.168.1.3",
            port,
            40123,
            DavConnector::new(None, KnownHostsStore::new().into(), None),
        )
    }

    fn rewritten_cookie(text: &str) -> String {
        rewrite_set_cookie(&HeaderValue::from_str(text).unwrap())
            .to_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn cookies_lose_secure_and_domain_but_keep_the_rest() {
        assert_eq!(
            rewritten_cookie("PVEAuthCookie=abc; path=/; secure; HttpOnly; SameSite=Lax"),
            "PVEAuthCookie=abc; path=/; HttpOnly; SameSite=Lax"
        );
        assert_eq!(
            rewritten_cookie("a=b; Domain=example.com; Path=/; Secure"),
            "a=b; Path=/"
        );
    }

    #[test]
    fn samesite_none_becomes_lax_because_it_needs_secure() {
        assert_eq!(
            rewritten_cookie("a=b; SameSite=None; Secure"),
            "a=b; SameSite=Lax"
        );
    }

    #[test]
    fn a_cookie_value_that_looks_like_an_attribute_is_left_alone() {
        assert_eq!(
            rewritten_cookie("secure_token=1; Path=/"),
            "secure_token=1; Path=/"
        );
    }

    #[tokio::test]
    async fn redirects_to_the_host_point_at_the_proxy() {
        let up = upstream(8006);
        let loc = |v: &str| {
            rewrite_location(&up, &HeaderValue::from_str(v).unwrap())
                .to_str()
                .unwrap()
                .to_string()
        };
        assert_eq!(
            loc("https://192.168.1.3:8006/login?x=1"),
            "http://127.0.0.1:40123/login?x=1"
        );
        assert_eq!(loc("https://192.168.1.3:8006"), "http://127.0.0.1:40123");
        assert_eq!(loc("/relative"), "/relative");
        assert_eq!(loc("https://other.example/"), "https://other.example/");
        assert_eq!(
            loc("https://192.168.1.3:80060/"),
            "https://192.168.1.3:80060/"
        );
    }

    #[tokio::test]
    async fn the_default_port_may_be_left_out_of_a_redirect() {
        let up = upstream(443);
        let out = rewrite_location(&up, &HeaderValue::from_static("https://192.168.1.3/a"));
        assert_eq!(out.to_str().unwrap(), "http://127.0.0.1:40123/a");
    }

    #[tokio::test]
    async fn origin_and_referer_name_the_host_not_the_proxy() {
        let up = upstream(8006);
        let o = rewrite_request_value(
            &up,
            &header::ORIGIN,
            &HeaderValue::from_static("http://127.0.0.1:40123"),
        );
        assert_eq!(o.to_str().unwrap(), "https://192.168.1.3:8006");
        let r = rewrite_request_value(
            &up,
            &header::REFERER,
            &HeaderValue::from_static("http://127.0.0.1:40123/a?b"),
        );
        assert_eq!(r.to_str().unwrap(), "https://192.168.1.3:8006/a?b");
        let other = rewrite_request_value(
            &up,
            &header::ORIGIN,
            &HeaderValue::from_static("https://elsewhere"),
        );
        assert_eq!(other.to_str().unwrap(), "https://elsewhere");
    }

    #[test]
    fn a_host_always_maps_to_the_same_port_in_the_dynamic_range() {
        let port = stable_port("192.168.1.3:8006");
        assert_eq!(port, stable_port("192.168.1.3:8006"));
        assert!((49152..65152).contains(&port));
    }

    #[test]
    fn only_a_real_upgrade_request_is_tunnelled() {
        let mut h = HeaderMap::new();
        h.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
        assert!(!is_upgrade(&h));
        h.insert(
            header::CONNECTION,
            HeaderValue::from_static("keep-alive, Upgrade"),
        );
        assert!(is_upgrade(&h));
    }
}
