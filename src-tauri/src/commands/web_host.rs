//! Web hosts (HTTP/HTTPS): show the host's web UI (Proxmox, a router, a dashboard…)
//! instead of a terminal. Two ways to show it:
//!
//! - a **pane**: a webview embedded in the main window, kept over the tab's area by the
//!   frontend (`web_pane_sync` / `web_pane_close`);
//! - a **separate window** (`web_host_open`).
//!
//! Both load remote content, so they get no Tauri capability: the page cannot call
//! `invoke` into Voltius. Desktop only — mobile has no multi-webview windows.

use crate::error::AppError;
use crate::known_hosts::KnownHostsStore;
use crate::web_proxy::WebProxies;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

/// Where a pane sits in the main window, in logical (CSS) pixels from its top-left corner.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct PaneBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[tauri::command]
pub async fn web_host_open(
    app: tauri::AppHandle,
    proxies: State<'_, WebProxies>,
    known_hosts: State<'_, Arc<KnownHostsStore>>,
    connection_id: String,
    title: String,
    url: String,
) -> Result<(), AppError> {
    open_window(
        app,
        &proxies,
        Arc::clone(&known_hosts),
        &connection_id,
        &title,
        &url,
    )
    .await
}

/// Create, move or hide the pane of a session. `Some(bounds)` shows it there (creating the
/// webview on first use); `None` hides it, keeping the page loaded for when its tab returns.
/// Showing a native webview takes the keyboard from the app's own; `refocus_app` gives it back
/// (the page was only uncovered while the user types in a popover).
#[tauri::command]
pub async fn web_pane_sync(
    app: tauri::AppHandle,
    proxies: State<'_, WebProxies>,
    known_hosts: State<'_, Arc<KnownHostsStore>>,
    session_id: String,
    url: String,
    bounds: Option<PaneBounds>,
    refocus_app: Option<bool>,
) -> Result<(), AppError> {
    sync_pane(
        app,
        &proxies,
        Arc::clone(&known_hosts),
        &session_id,
        &url,
        bounds,
        refocus_app.unwrap_or(false),
    )
    .await
}

/// The icon of a web page as a `data:` URL, for its tab: the page's `<link rel="icon">`, else
/// `/favicon.ico`. `None` when the host has none or cannot be reached. Goes through the same
/// pinned-certificate TLS as the page itself.
#[tauri::command]
pub async fn web_favicon(
    known_hosts: State<'_, Arc<KnownHostsStore>>,
    url: String,
) -> Result<Option<String>, AppError> {
    Ok(favicon::fetch(Arc::clone(&known_hosts), &url).await)
}

/// Destroy the pane of a session that was closed. Succeeds when there is none.
#[tauri::command]
pub async fn web_pane_close(
    app: tauri::AppHandle,
    proxies: State<'_, WebProxies>,
    session_id: String,
) -> Result<(), AppError> {
    close_pane(app, &session_id)?;
    proxies.stop(&label_for("web-pane", &session_id)).await;
    Ok(())
}

/// A proxied page runs on plain `http://127.0.0.1`, which breaks two things a page may assume of
/// its HTTPS origin, so the script undoes them in every frame (Proxmox's console is an iframe):
/// - WebKit drops cookies a script sets with `Secure` (Proxmox does, to store its login ticket).
///   Strip that flag, as the proxy does for `Set-Cookie` headers.
/// - A `wss://` socket to the page's own address meets a proxy that only speaks plain HTTP
///   (Proxmox's noVNC always asks for `wss://`). Open it as `ws://`; the proxy still talks TLS to
///   the host.
#[cfg(desktop)]
const PROXIED_PAGE_SCRIPT: &str = r#"(function () {
  var d = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (d && d.set) {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: function () { return d.get.call(document); },
      set: function (v) {
        d.set.call(document, String(v)
          .replace(/;\s*secure\s*(?=;|$)/ig, '')
          .replace(/;\s*samesite\s*=\s*none/ig, '; SameSite=Lax'));
      }
    });
  }
  var WS = window.WebSocket;
  if (WS) {
    window.WebSocket = class extends WS {
      constructor(url, protocols) {
        try {
          var u = new URL(url, location.href);
          if (u.protocol === 'wss:' && u.host === location.host) {
            u.protocol = 'ws:';
            url = u.href;
          }
        } catch (e) {}
        if (protocols === undefined) super(url); else super(url, protocols);
      }
    };
  }
})();"#;

#[cfg(desktop)]
fn app_error(e: tauri::Error) -> AppError {
    AppError::from(e.to_string())
}

#[cfg(desktop)]
fn parse_web_url(url: &str) -> Result<tauri::Url, AppError> {
    let parsed = tauri::Url::parse(url).map_err(|e| AppError::from(format!("Invalid URL: {e}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::from(
            "Only http:// and https:// addresses can be opened",
        ));
    }
    Ok(parsed)
}

/// One window per host: opening an already-open host just brings it to the front.
#[cfg(desktop)]
async fn open_window(
    app: tauri::AppHandle,
    proxies: &WebProxies,
    known_hosts: Arc<KnownHostsStore>,
    connection_id: &str,
    title: &str,
    url: &str,
) -> Result<(), AppError> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    parse_web_url(url)?;
    let label = label_for("web", connection_id);
    if let Some(existing) = app.get_webview_window(&label) {
        existing.show().map_err(app_error)?;
        existing.set_focus().map_err(app_error)?;
        return Ok(());
    }

    // A host whose certificate no CA vouches for is shown through a local proxy.
    let resolved = proxies.resolve(&label, url, known_hosts).await?;
    let mut builder = WebviewWindowBuilder::new(
        &app,
        label.clone(),
        WebviewUrl::External(parse_web_url(&resolved)?),
    )
    .title(title)
    .inner_size(1280.0, 800.0);
    if resolved != url {
        builder = builder.initialization_script_for_all_frames(PROXIED_PAGE_SCRIPT);
    }
    let window = builder.build().map_err(app_error)?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let handle = handle.clone();
            let label = label.clone();
            tauri::async_runtime::spawn(async move {
                handle.state::<WebProxies>().stop(&label).await;
            });
        }
    });
    Ok(())
}

#[cfg(desktop)]
async fn sync_pane(
    app: tauri::AppHandle,
    proxies: &WebProxies,
    known_hosts: Arc<KnownHostsStore>,
    session_id: &str,
    url: &str,
    bounds: Option<PaneBounds>,
    refocus_app: bool,
) -> Result<(), AppError> {
    use tauri::{LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl};

    let label = label_for("web-pane", session_id);
    let placement = bounds.map(|b| {
        (
            LogicalPosition::new(b.x, b.y),
            LogicalSize::new(b.width, b.height),
        )
    });
    match (app.get_webview(&label), placement) {
        (Some(webview), Some((position, size))) => {
            webview.set_position(position).map_err(app_error)?;
            webview.set_size(size).map_err(app_error)?;
            webview.show().map_err(app_error)?;
            if refocus_app {
                if let Some(main) = app.get_webview("main") {
                    let _ = main.set_focus();
                }
            }
        }
        (Some(webview), None) => webview.hide().map_err(app_error)?,
        (None, Some((position, size))) => {
            parse_web_url(url)?;
            let resolved = proxies.resolve(&label, url, known_hosts).await?;
            let mut builder =
                WebviewBuilder::new(label, WebviewUrl::External(parse_web_url(&resolved)?));
            if resolved != url {
                builder = builder.initialization_script_for_all_frames(PROXIED_PAGE_SCRIPT);
            }
            let window = app
                .get_window("main")
                .ok_or_else(|| AppError::from("Main window not found"))?;
            window
                .add_child(builder, position, size)
                .map_err(app_error)?;
        }
        (None, None) => {}
    }
    Ok(())
}

#[cfg(desktop)]
fn close_pane(app: tauri::AppHandle, session_id: &str) -> Result<(), AppError> {
    use tauri::Manager;

    if let Some(webview) = app.get_webview(&label_for("web-pane", session_id)) {
        webview.close().map_err(app_error)?;
    }
    Ok(())
}

#[cfg(not(desktop))]
async fn open_window(
    _app: tauri::AppHandle,
    _proxies: &WebProxies,
    _known_hosts: Arc<KnownHostsStore>,
    _connection_id: &str,
    _title: &str,
    _url: &str,
) -> Result<(), AppError> {
    Err(AppError::from("Web hosts can only be opened on desktop"))
}

#[cfg(not(desktop))]
async fn sync_pane(
    _app: tauri::AppHandle,
    _proxies: &WebProxies,
    _known_hosts: Arc<KnownHostsStore>,
    _session_id: &str,
    _url: &str,
    _bounds: Option<PaneBounds>,
    _refocus_app: bool,
) -> Result<(), AppError> {
    Err(AppError::from("Web hosts can only be opened on desktop"))
}

#[cfg(not(desktop))]
fn close_pane(_app: tauri::AppHandle, _session_id: &str) -> Result<(), AppError> {
    Ok(())
}

mod favicon {
    use crate::known_hosts::KnownHostsStore;
    use crate::webdav::connector::DavConnector;
    use base64::Engine;
    use bytes::Bytes;
    use http_body_util::{BodyExt, Empty, Limited};
    use hyper::{Request, Uri};
    use hyper_util::client::legacy::Client;
    use hyper_util::rt::TokioExecutor;
    use std::sync::Arc;
    use std::time::Duration;
    use url::Url;

    const TIMEOUT: Duration = Duration::from_secs(6);
    const MAX_PAGE: usize = 512 * 1024;
    const MAX_ICON: usize = 256 * 1024;

    pub async fn fetch(known_hosts: Arc<KnownHostsStore>, page: &str) -> Option<String> {
        let page = Url::parse(page).ok()?;
        let client = Client::builder(TokioExecutor::new())
            .build::<_, Empty<Bytes>>(DavConnector::new(None, known_hosts, None));
        tokio::time::timeout(TIMEOUT, async {
            let html = get(&client, &page, MAX_PAGE).await.map(|(_, body)| body);
            let declared = html
                .as_deref()
                .and_then(|body| find_icon_href(&String::from_utf8_lossy(body)))
                .and_then(|href| page.join(&href).ok());
            let fallback = page.join("/favicon.ico").ok();
            for candidate in declared.into_iter().chain(fallback) {
                if let Some((content_type, body)) = get(&client, &candidate, MAX_ICON).await {
                    if let Some(mime) = image_mime(&content_type, candidate.path()) {
                        let encoded = base64::engine::general_purpose::STANDARD.encode(body);
                        return Some(format!("data:{mime};base64,{encoded}"));
                    }
                }
            }
            None
        })
        .await
        .ok()
        .flatten()
    }

    async fn get(
        client: &Client<DavConnector, Empty<Bytes>>,
        url: &Url,
        limit: usize,
    ) -> Option<(String, Bytes)> {
        let uri: Uri = url.as_str().parse().ok()?;
        let request = Request::get(uri).body(Empty::new()).ok()?;
        let resp = client.request(request).await.ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let content_type = resp
            .headers()
            .get(hyper::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let body = Limited::new(resp.into_body(), limit)
            .collect()
            .await
            .ok()?
            .to_bytes();
        Some((content_type, body))
    }

    /// The image type to give the browser, from the response or else the file extension.
    pub(super) fn image_mime(content_type: &str, path: &str) -> Option<String> {
        let declared = content_type.split(';').next().unwrap_or_default().trim();
        if declared.starts_with("image/") {
            return Some(declared.to_string());
        }
        let ext = path.rsplit('.').next()?.to_ascii_lowercase();
        let mime = match ext.as_str() {
            "ico" => "image/x-icon",
            "png" => "image/png",
            "svg" => "image/svg+xml",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            _ => return None,
        };
        // A page served instead of the icon (a login redirect, an error page).
        (!declared.starts_with("text/")).then(|| mime.to_string())
    }

    /// The `href` of the first `<link rel="icon">` (or `shortcut icon`) in a page.
    pub(super) fn find_icon_href(html: &str) -> Option<String> {
        let lower = html.to_ascii_lowercase();
        let mut from = 0;
        while let Some(start) = lower[from..].find("<link") {
            let start = from + start;
            let end = lower[start..].find('>').map_or(lower.len(), |e| start + e);
            let (tag, tag_lower) = (&html[start..end], &lower[start..end]);
            from = end;
            let is_icon = attribute(tag, tag_lower, "rel").is_some_and(|rel| {
                rel.to_ascii_lowercase()
                    .split_whitespace()
                    .any(|t| t == "icon")
            });
            if is_icon {
                if let Some(href) = attribute(tag, tag_lower, "href").filter(|h| !h.is_empty()) {
                    return Some(href);
                }
            }
        }
        None
    }

    /// The value of `name="..."` (or single-quoted) in a tag.
    fn attribute(tag: &str, tag_lower: &str, name: &str) -> Option<String> {
        let mut from = 0;
        while let Some(pos) = tag_lower[from..].find(name) {
            let at = from + pos;
            from = at + name.len();
            let before_ok = tag_lower[..at].ends_with(char::is_whitespace);
            let rest = tag[from..].trim_start();
            if !before_ok || !rest.starts_with('=') {
                continue;
            }
            let value = rest[1..].trim_start();
            let quote = value.chars().next().filter(|c| *c == '"' || *c == '\'')?;
            let inner = &value[1..];
            return inner.find(quote).map(|e| inner[..e].to_string());
        }
        None
    }
}

/// Tauri labels allow only `a-zA-Z0-9`, `-`, `/`, `:` and `_`.
#[cfg(any(desktop, test))]
fn label_for(prefix: &str, id: &str) -> String {
    let safe: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{prefix}-{safe}")
}

#[cfg(test)]
mod tests {
    use super::favicon::{find_icon_href, image_mime};
    use super::{label_for, PaneBounds};

    #[test]
    fn the_icon_is_found_among_the_links_of_a_page() {
        let html = r#"<head><link rel="stylesheet" href="/a.css"><link href='/pve2/logo.png' REL='Shortcut Icon'/><link rel="icon" href="/other.ico"></head>"#;
        assert_eq!(find_icon_href(html).as_deref(), Some("/pve2/logo.png"));
        assert_eq!(
            find_icon_href(r#"<link rel="apple-touch-icon" href="/a.png">"#),
            None
        );
        assert_eq!(find_icon_href("<p>no icon</p>"), None);
    }

    #[test]
    fn an_icon_must_be_an_image_not_a_page() {
        assert_eq!(image_mime("image/png", "/x").as_deref(), Some("image/png"));
        assert_eq!(
            image_mime("", "/favicon.ico").as_deref(),
            Some("image/x-icon")
        );
        assert_eq!(image_mime("text/html; charset=utf-8", "/favicon.ico"), None);
        assert_eq!(image_mime("", "/page"), None);
    }

    #[test]
    fn label_keeps_uuids_and_replaces_unsafe_characters() {
        assert_eq!(label_for("web", "3f2b-9c"), "web-3f2b-9c");
        assert_eq!(label_for("web", "a b/c.d"), "web-a_b_c_d");
    }

    #[test]
    fn pane_and_window_labels_never_collide_for_the_same_id() {
        assert_ne!(label_for("web", "x"), label_for("web-pane", "x"));
    }

    #[test]
    fn bounds_deserialize_from_the_frontend_shape() {
        let b: PaneBounds =
            serde_json::from_str(r#"{"x":10.5,"y":20,"width":300,"height":200}"#).unwrap();
        assert_eq!((b.x, b.y, b.width, b.height), (10.5, 20.0, 300.0, 200.0));
    }
}
