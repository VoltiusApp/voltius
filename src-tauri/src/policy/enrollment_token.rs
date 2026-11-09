use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use url::Url;

#[derive(Debug, PartialEq, Eq)]
pub struct EnrollmentToken {
    pub server_url: String,
    pub id: String,
    pub secret: String,
}

fn is_id(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn is_secret(s: &str) -> bool {
    s.len() == 43
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn parse(text: &str) -> Option<EnrollmentToken> {
    let parts: Vec<&str> = text.trim().split('.').collect();
    let [prefix, encoded, id, secret] = parts.as_slice() else {
        return None;
    };
    if *prefix != "vte1" || !is_id(id) || !is_secret(secret) {
        return None;
    }
    let server_url = String::from_utf8(URL_SAFE_NO_PAD.decode(encoded).ok()?).ok()?;
    matches!(Url::parse(&server_url).ok()?.scheme(), "http" | "https").then(|| EnrollmentToken {
        server_url,
        id: id.to_string(),
        secret: secret.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn fixture_cases_match() {
        let rows: Vec<Value> =
            serde_json::from_str(include_str!("fixtures/enrollment_token.json")).unwrap();
        for row in rows {
            let text = row["text"].as_str().unwrap();
            let want = row["expect"].as_object().map(|o| EnrollmentToken {
                server_url: o["serverUrl"].as_str().unwrap().to_string(),
                id: o["id"].as_str().unwrap().to_string(),
                secret: o["secret"].as_str().unwrap().to_string(),
            });
            assert_eq!(parse(text), want, "{text:?}");
        }
    }
}
