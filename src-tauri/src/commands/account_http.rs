use serde::Serialize;

#[derive(Serialize)]
pub struct AccountHttpResponse {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn account_http_request(
    url: String,
    method: String,
    body: Option<String>,
) -> Result<AccountHttpResponse, String> {
    let url = reqwest::Url::parse(&url).map_err(|_| "invalid URL".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("unsupported URL scheme".to_string());
    }
    if !url.path().starts_with("/v1/auth/") {
        return Err("unsupported account endpoint".to_string());
    }

    let method = method.to_uppercase();
    if method != "GET" && method != "POST" {
        return Err("unsupported method".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Voltius")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let request = if method == "POST" {
        client
            .post(url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body.unwrap_or_default())
    } else {
        client.get(url)
    };

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| e.to_string())?;

    Ok(AccountHttpResponse { status, body })
}
