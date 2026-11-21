//! Serves a self-signed HTTPS host on `http://127.0.0.1:<port>` using WebDAV's pinned-certificate TLS.
//! Every proxied host shares the 127.0.0.1 cookie jar, so each one's cookie names carry its own prefix.

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
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::client::legacy::Client;
use hyper_util::rt::{TokioExecutor, TokioIo};
use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tower_service::Service;
use url::{Position, Url};

type ProxyBody = BoxBody<Bytes, hyper::Error>;

// Below the common 5 s server keep-alive, so the pool drops a connection before the server does.
const POOL_IDLE: Duration = Duration::from_secs(4);

const REDIRECT_PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// One proxy per upstream `host:port`, shared by the panes and windows showing it.
#[derive(Default)]
pub struct WebProxies {
    running: Mutex<HashMap<String, Running>>,
}

struct Running {
    origin: String,
    cookie_prefix: String,
    stop: CancellationToken,
    /// `resolve` keys using it; it stops with the last one.
    users: HashSet<String>,
}

/// What a webview should load, and the script a proxied page needs in every frame.
pub struct Resolved {
    pub url: String,
    pub page_script: Option<String>,
}

impl Resolved {
    fn direct(url: &str) -> Self {
        Self {
            url: url.to_string(),
            page_script: None,
        }
    }

    fn proxied(running: &Running, rest: &str) -> Self {
        Self {
            url: format!("{}{rest}", running.origin),
            page_script: Some(page_script(&running.cookie_prefix)),
        }
    }
}

/// Undoes in the page what `http://127.0.0.1` breaks: `Secure` script cookies, shared cookie names,
/// and `wss://` to itself. Wraps WebSocket without subclassing: noVNC checks the direct prototype.
const PAGE_SCRIPT: &str = r#"(function (p) {
  var d = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (d && d.get && d.set) {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: function () {
        return d.get.call(document).split('; ')
          .filter(function (c) { return c.indexOf(p) === 0; })
          .map(function (c) { return c.slice(p.length); })
          .join('; ');
      },
      set: function (v) {
        d.set.call(document, p + String(v).replace(/^\s+/, '')
          .replace(/;\s*secure\s*(?=;|$)/ig, '')
          .replace(/;\s*samesite\s*=\s*none/ig, '; SameSite=Lax'));
      }
    });
  }
  var WS = window.WebSocket;
  if (WS) {
    var Wrapped = function WebSocket(url, protocols) {
      try {
        var u = new URL(url, location.href);
        if (u.protocol === 'wss:' && u.host === location.host) {
          u.protocol = 'ws:';
          url = u.href;
        }
      } catch (e) {}
      return protocols === undefined ? new WS(url) : new WS(url, protocols);
    };
    Wrapped.prototype = WS.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { Wrapped[k] = WS[k]; });
    window.WebSocket = Wrapped;
  }
})"#;

fn page_script(cookie_prefix: &str) -> String {
    format!("{PAGE_SCRIPT}({cookie_prefix:?});")
}

impl WebProxies {
    /// `url` itself when plain HTTP or CA-signed, else a local proxy registered under `key`.
    /// HTTP that redirects to its own HTTPS counts as HTTPS: the webview would hit the refused cert.
    pub async fn resolve(
        &self,
        key: &str,
        url: &str,
        known_hosts: Arc<KnownHostsStore>,
    ) -> Result<Resolved, AppError> {
        let mut parsed =
            Url::parse(url).map_err(|e| AppError::from(format!("Invalid URL: {e}")))?;
        if parsed.scheme() != "https" {
            match https_redirect_target(&parsed).await {
                Some(target) => parsed = target,
                None => return Ok(Resolved::direct(url)),
            }
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
            return Ok(Resolved::proxied(running, &rest));
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
            return Ok(Resolved::direct(url));
        }

        // A stable port keeps the origin, and with it the page's local storage, across restarts.
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
        // Re-checked under the lock held until insert: a concurrent resolve may have started one.
        let mut running = self.running.lock().await;
        if let Some(existing) = running.get_mut(&authority) {
            existing.users.insert(key.to_string());
            return Ok(Resolved::proxied(existing, &rest));
        }
        let upstream = Arc::new(Upstream::new(&shown_host, port, local_port, connector));
        let entry = Running {
            origin: upstream.local_origin.clone(),
            cookie_prefix: upstream.cookie_prefix.clone(),
            stop: CancellationToken::new(),
            users: HashSet::from([key.to_string()]),
        };
        tokio::spawn(serve(listener, upstream, entry.stop.clone()));
        let resolved = Resolved::proxied(&entry, &rest);
        running.insert(authority, entry);
        Ok(resolved)
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

/// The same-host HTTPS target the plain-HTTP `url` redirects to, if any.
async fn https_redirect_target(url: &Url) -> Option<Url> {
    let client: Client<HttpConnector, Empty<Bytes>> =
        Client::builder(TokioExecutor::new()).build_http();
    let uri: Uri = url.as_str().parse().ok()?;
    let resp = tokio::time::timeout(REDIRECT_PROBE_TIMEOUT, client.get(uri))
        .await
        .ok()?
        .ok()?;
    if !resp.status().is_redirection() {
        return None;
    }
    let location = resp.headers().get(header::LOCATION)?.to_str().ok()?;
    let target = url.join(location).ok()?;
    (target.scheme() == "https" && target.host_str() == url.host_str()).then_some(target)
}

/// FNV-1a: std's hasher may change between Rust releases, and these values outlive a build.
fn stable_hash(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
    })
}

fn stable_port(authority: &str) -> u16 {
    49152 + (stable_hash(authority) % 16000) as u16
}

struct Upstream {
    /// `host:port` as in a URI, an IPv6 host bracketed.
    authority: String,
    /// `https://host:port`, plus `https://host` when the port is 443.
    upstream_prefixes: Vec<String>,
    local_origin: String,
    local_authority: String,
    cookie_prefix: String,
    connector: DavConnector,
    client: Client<DavConnector, ProxyBody>,
}

impl Upstream {
    fn new(shown_host: &str, port: u16, local_port: u16, connector: DavConnector) -> Self {
        let mut upstream_prefixes = vec![format!("https://{shown_host}:{port}")];
        if port == 443 {
            upstream_prefixes.push(format!("https://{shown_host}"));
        }
        let authority = format!("{shown_host}:{port}");
        Self {
            cookie_prefix: format!("vt{:08x}_", stable_hash(&authority) as u32),
            authority,
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
    // Refuses DNS rebinding: a page on another name pointed at 127.0.0.1.
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
        let value = if *name == header::COOKIE {
            match own_cookies(&upstream.cookie_prefix, value) {
                Some(value) => value,
                None => continue,
            }
        } else {
            rewrite_request_value(upstream, name, value)
        };
        headers.append(name.clone(), value);
    }

    if let Some(client_upgrade) = client_upgrade {
        // A raw connection, unlike the pooled client, sets neither Host nor origin-form itself.
        headers.insert(
            header::HOST,
            HeaderValue::from_str(&upstream.authority).map_err(|e| e.to_string())?,
        );
        let mut request = Request::new(Empty::<Bytes>::new());
        *request.method_mut() = parts.method;
        *request.uri_mut() = path.parse().map_err(|e| format!("Invalid address: {e}"))?;
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

/// Connects to `uri` and, once the host accepts the upgrade, pipes the two sides together.
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

fn keeps_for_upgrade(name: &HeaderName) -> bool {
    *name == header::CONNECTION || *name == header::UPGRADE
}

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
            rewrite_set_cookie(&upstream.cookie_prefix, value)
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

/// Over `http://127.0.0.1` the webview drops `Secure` cookies and never matches `Domain`;
/// `SameSite=None` needs `Secure`. The name gets the host's prefix.
fn rewrite_set_cookie(prefix: &str, value: &HeaderValue) -> HeaderValue {
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
    HeaderValue::from_str(&format!("{prefix}{}", kept.join("; "))).unwrap_or_else(|_| value.clone())
}

/// Only this host's cookies, prefix removed; `None` when it has none. Others never leave the machine.
fn own_cookies(prefix: &str, value: &HeaderValue) -> Option<HeaderValue> {
    let text = value.to_str().ok()?;
    let own: Vec<&str> = text
        .split(';')
        .filter_map(|pair| pair.trim().strip_prefix(prefix))
        .collect();
    if own.is_empty() {
        return None;
    }
    HeaderValue::from_str(&own.join("; ")).ok()
}

fn starts_with_ignore_case(text: &str, prefix: &str) -> bool {
    text.get(..prefix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
}

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
        rewrite_set_cookie("p_", &HeaderValue::from_str(text).unwrap())
            .to_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn cookies_lose_secure_and_domain_but_keep_the_rest() {
        assert_eq!(
            rewritten_cookie("PVEAuthCookie=abc; path=/; secure; HttpOnly; SameSite=Lax"),
            "p_PVEAuthCookie=abc; path=/; HttpOnly; SameSite=Lax"
        );
        assert_eq!(
            rewritten_cookie("a=b; Domain=example.com; Path=/; Secure"),
            "p_a=b; Path=/"
        );
    }

    #[test]
    fn samesite_none_becomes_lax_because_it_needs_secure() {
        assert_eq!(
            rewritten_cookie("a=b; SameSite=None; Secure"),
            "p_a=b; SameSite=Lax"
        );
    }

    #[test]
    fn a_cookie_value_that_looks_like_an_attribute_is_left_alone() {
        assert_eq!(
            rewritten_cookie("secure_token=1; Path=/"),
            "p_secure_token=1; Path=/"
        );
    }

    #[test]
    fn only_the_hosts_own_cookies_are_forwarded_to_it() {
        let own = |v: &str| {
            own_cookies("p_", &HeaderValue::from_str(v).unwrap())
                .map(|v| v.to_str().unwrap().to_string())
        };
        assert_eq!(
            own("p_PVEAuthCookie=a; q_PVEAuthCookie=b; p_x=1").as_deref(),
            Some("PVEAuthCookie=a; x=1")
        );
        assert_eq!(own("q_PVEAuthCookie=b; legacy=1"), None);
    }

    #[test]
    fn each_upstream_gets_its_own_cookie_prefix() {
        let a = Upstream::new("192.168.1.3", 8006, 1, upstream(8006).connector);
        let b = Upstream::new("192.168.1.4", 8006, 1, upstream(8006).connector);
        assert_ne!(a.cookie_prefix, b.cookie_prefix);
        assert_eq!(a.cookie_prefix, upstream(8006).cookie_prefix);
        assert!(page_script(&a.cookie_prefix).ends_with(&format!("(\"{}\");", a.cookie_prefix)));
    }

    /// A one-shot HTTP server on localhost that answers every request with `response`.
    async fn answering(response: &'static str) -> Url {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
            let _ = socket.write_all(response.as_bytes()).await;
        });
        Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap()
    }

    #[tokio::test]
    async fn an_http_host_redirecting_to_its_own_https_is_followed() {
        let url = answering(
            "HTTP/1.1 301 Moved\r\nLocation: https://127.0.0.1:8006/\r\nContent-Length: 0\r\n\r\n",
        )
        .await;
        let target = https_redirect_target(&url).await.unwrap();
        assert_eq!(target.as_str(), "https://127.0.0.1:8006/");
    }

    #[tokio::test]
    async fn a_redirect_elsewhere_or_a_plain_page_is_not_followed() {
        let elsewhere = answering(
            "HTTP/1.1 302 Found\r\nLocation: https://other.example/\r\nContent-Length: 0\r\n\r\n",
        )
        .await;
        assert!(https_redirect_target(&elsewhere).await.is_none());
        let page = answering("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok").await;
        assert!(https_redirect_target(&page).await.is_none());
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
