use serde::{Deserialize, Serialize};

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

    let mut builder = reqwest::Client::builder().user_agent("Voltius");
    if let Some(ms) = connect_timeout_ms {
        builder = builder.connect_timeout(std::time::Duration::from_millis(ms));
    }
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
