use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[derive(Deserialize)]
pub struct HttpRequestHeader {
    name: String,
    value: String,
}

#[derive(Serialize)]
pub struct HttpResponseHeader {
    name: String,
    value: String,
}

#[derive(Serialize)]
pub struct HttpResponse {
    status: u16,
    status_text: String,
    headers: Vec<HttpResponseHeader>,
    body: String,
}

#[derive(Clone, Serialize)]
pub struct HttpSseClosedPayload {
    error: Option<String>,
}

pub struct HttpSseStreamManager {
    streams: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

impl HttpSseStreamManager {
    pub fn new() -> Self {
        Self {
            streams: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn stop(&self, stream_id: &str) {
        if let Some(handle) = self.streams.lock().await.remove(stream_id) {
            handle.abort();
        }
    }
}

/// reqwest client builder with a platform-appropriate TLS stack.
///
/// On Android, reqwest's default rustls path (aws-lc-rs provider + an *uninitialised*
/// rustls-platform-verifier trust store) hangs the TLS handshake forever — every HTTPS
/// request, including cloud login, never completes. We hand reqwest a preconfigured
/// rustls config using the `ring` provider and bundled webpki roots instead. Desktop
/// keeps reqwest's working default.
fn client_builder() -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder().user_agent("Voltius");
    #[cfg(target_os = "android")]
    let builder = builder.use_preconfigured_tls(android_tls_config());
    builder
}

#[cfg(target_os = "android")]
fn android_tls_config() -> rustls::ClientConfig {
    use std::sync::OnceLock;
    static CFG: OnceLock<rustls::ClientConfig> = OnceLock::new();
    CFG.get_or_init(|| {
        let mut roots = rustls::RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .expect("ring provider supports the default TLS protocol versions")
        .with_root_certificates(roots)
        .with_no_client_auth()
    })
    .clone()
}

#[tauri::command]
pub async fn http_request(
    url: String,
    method: String,
    headers: Vec<HttpRequestHeader>,
    body: Option<String>,
    connect_timeout_ms: Option<u64>,
) -> Result<HttpResponse, String> {
    let url = reqwest::Url::parse(&url).map_err(|_| "invalid URL".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("unsupported URL scheme".to_string());
    }

    let method = match method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err("unsupported HTTP method".to_string()),
    };

    let mut builder = client_builder();
    if let Some(ms) = connect_timeout_ms {
        builder = builder.connect_timeout(std::time::Duration::from_millis(ms));
    }
    // Defensive overall cap: a stalled handshake or read must surface as an error,
    // never an indefinitely-pending IPC promise (which froze the cloud-login UI on Android).
    builder = builder.timeout(std::time::Duration::from_secs(30));
    let client = builder.build().map_err(|e| e.to_string())?;

    let mut request = client.request(method, url);
    for header in headers {
        request = request.header(header.name, header.value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value.to_str().ok().map(|value| HttpResponseHeader {
                name: name.to_string(),
                value: value.to_string(),
            })
        })
        .collect();
    let body = response.text().await.map_err(|e| e.to_string())?;

    Ok(HttpResponse {
        status: status.as_u16(),
        status_text,
        headers,
        body,
    })
}

#[tauri::command]
pub async fn http_sse_start(
    app: AppHandle,
    stream_manager: State<'_, HttpSseStreamManager>,
    stream_id: String,
    url: String,
    headers: Vec<HttpRequestHeader>,
) -> Result<(), String> {
    let url = reqwest::Url::parse(&url).map_err(|_| "invalid URL".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("unsupported URL scheme".to_string());
    }

    let task_stream_id = stream_id.clone();
    let join_handle = tokio::spawn(async move {
        let data_event = format!("http:sse:data:{task_stream_id}");
        let closed_event = format!("http:sse:closed:{task_stream_id}");
        let close = |app: &AppHandle, error: Option<String>| {
            let _ = app.emit(&closed_event, HttpSseClosedPayload { error });
        };

        let client = match client_builder().build() {
            Ok(client) => client,
            Err(e) => {
                close(&app, Some(e.to_string()));
                return;
            }
        };

        let mut request = client.get(url);
        for header in headers {
            request = request.header(header.name, header.value);
        }

        let mut response = match request.send().await {
            Ok(response) => response,
            Err(e) => {
                close(&app, Some(e.to_string()));
                return;
            }
        };

        if !response.status().is_success() {
            close(
                &app,
                Some(format!("Server error: {}", response.status().as_u16())),
            );
            return;
        }

        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    let text = String::from_utf8_lossy(&chunk).to_string();
                    let _ = app.emit(&data_event, text);
                }
                Ok(None) => {
                    close(&app, None);
                    return;
                }
                Err(e) => {
                    close(&app, Some(e.to_string()));
                    return;
                }
            }
        }
    });

    stream_manager
        .streams
        .lock()
        .await
        .insert(stream_id, join_handle);

    Ok(())
}

#[tauri::command]
pub async fn http_sse_stop(
    stream_manager: State<'_, HttpSseStreamManager>,
    stream_id: String,
) -> Result<(), String> {
    stream_manager.stop(&stream_id).await;
    Ok(())
}
