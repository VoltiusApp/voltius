//! Minimal OCI registry client for update checks.
//!
//! Reads the current manifest digest for an image tag with a **HEAD** request to
//! `/v2/<repo>/manifests/<tag>`, returning the `Docker-Content-Digest` header.
//! Docker Hub (and registries generally) rate-limit manifest *GET*s — what
//! `docker pull` and `docker buildx imagetools inspect` do — but HEAD requests
//! are not counted, so update checks no longer consume the pull quota.

use std::time::Duration;

use reqwest::header::{ACCEPT, WWW_AUTHENTICATE};
use serde::Deserialize;

const MANIFEST_ACCEPT: &str = "application/vnd.oci.image.index.v1+json, \
application/vnd.docker.distribution.manifest.list.v2+json, \
application/vnd.docker.distribution.manifest.v2+json, \
application/vnd.oci.image.manifest.v1+json";

/// Parse an image reference into `(registry, repository, reference)`.
fn parse_ref(image: &str) -> (String, String, String) {
    // Compare by tag; drop any pinned `@sha256:…`.
    let image = image.split('@').next().unwrap_or(image);

    // A leading component is a registry only if it looks like a host.
    let (registry, remainder) = match image.split_once('/') {
        Some((first, rest))
            if first.contains('.') || first.contains(':') || first == "localhost" =>
        {
            (first.to_string(), rest.to_string())
        }
        _ => ("docker.io".to_string(), image.to_string()),
    };

    let (repo, reference) = match remainder.rsplit_once(':') {
        Some((r, tag)) if !tag.contains('/') => (r.to_string(), tag.to_string()),
        _ => (remainder.clone(), "latest".to_string()),
    };

    // Docker Hub official images live under `library/`.
    let repo = if registry == "docker.io" && !repo.contains('/') {
        format!("library/{repo}")
    } else {
        repo
    };

    (registry, repo, reference)
}

fn registry_host(registry: &str) -> &str {
    if registry == "docker.io" || registry == "index.docker.io" {
        "registry-1.docker.io"
    } else {
        registry
    }
}

#[derive(Deserialize)]
struct TokenResp {
    #[serde(default)]
    token: String,
    #[serde(default)]
    access_token: String,
}

/// Current manifest digest for `image`'s tag, via a quota-free HEAD request.
pub async fn manifest_digest(image: &str) -> Result<String, String> {
    let (registry, repo, reference) = parse_ref(image);
    let host = registry_host(&registry);
    let url = format!("https://{host}/v2/{repo}/manifests/{reference}");

    let client = reqwest::Client::builder()
        .user_agent("voltius-docker-plugin")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let send = |bearer: Option<String>| {
        let mut req = client.head(&url).header(ACCEPT, MANIFEST_ACCEPT);
        if let Some(token) = bearer {
            req = req.bearer_auth(token);
        }
        req.send()
    };

    let resp = send(None).await.map_err(|e| format!("{e}"))?;

    let resp = if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        let challenge = resp
            .headers()
            .get(WWW_AUTHENTICATE)
            .and_then(|v| v.to_str().ok())
            .ok_or("registry requires auth but sent no challenge")?
            .to_string();
        let token = fetch_token(&client, &challenge).await?;
        send(Some(token)).await.map_err(|e| format!("{e}"))?
    } else {
        resp
    };

    if !resp.status().is_success() {
        return Err(format!("registry returned {}", resp.status()));
    }

    resp.headers()
        .get("docker-content-digest")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string())
        .filter(|d| d.starts_with("sha256:"))
        .ok_or_else(|| "registry sent no Docker-Content-Digest".to_string())
}

/// Parse a `Bearer realm="…",service="…",scope="…"` challenge and fetch an
/// anonymous token from the realm.
async fn fetch_token(client: &reqwest::Client, challenge: &str) -> Result<String, String> {
    let rest = challenge
        .trim()
        .strip_prefix("Bearer ")
        .ok_or("unsupported auth scheme")?;

    let (mut realm, mut service, mut scope) = (None, None, None);
    for part in rest.split(',') {
        let (k, v) = part.split_once('=').unwrap_or((part, ""));
        let v = v.trim().trim_matches('"');
        match k.trim() {
            "realm" => realm = Some(v.to_string()),
            "service" => service = Some(v.to_string()),
            "scope" => scope = Some(v.to_string()),
            _ => {}
        }
    }
    let realm = realm.ok_or("auth challenge missing realm")?;

    let mut url = reqwest::Url::parse(&realm).map_err(|e| format!("bad realm: {e}"))?;
    {
        let mut q = url.query_pairs_mut();
        if let Some(s) = &service {
            q.append_pair("service", s);
        }
        if let Some(s) = &scope {
            q.append_pair("scope", s);
        }
    }

    let body = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("token request: {e}"))?
        .text()
        .await
        .map_err(|e| format!("token body: {e}"))?;

    let parsed: TokenResp = serde_json::from_str(&body).map_err(|e| format!("token parse: {e}"))?;
    if !parsed.token.is_empty() {
        Ok(parsed.token)
    } else if !parsed.access_token.is_empty() {
        Ok(parsed.access_token)
    } else {
        Err("registry returned an empty token".to_string())
    }
}
