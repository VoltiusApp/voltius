use regex::Regex;
use std::sync::LazyLock;

static PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        // Bearer tokens in Authorization headers (must come before key=value to avoid matching "bearer" as a key)
        Regex::new(r"(?i)\bbearer\s+[A-Za-z0-9\-._~+/]+=*").unwrap(),
        // PEM private key blocks
        Regex::new(
            r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
        )
        .unwrap(),
        // key=value / key: value for common secret-bearing keys
        Regex::new(r#"(?i)\b(authorization|bearer|password|passwd|pwd|secret|token|api[_-]?key)\b\s*[=:]\s*\S+(?:\s+\S+)?"#)
            .unwrap(),
    ]
});

/// Replace secret-looking substrings with `[REDACTED]`. Defense-in-depth
/// backstop; the primary rule is that secrets are never logged in the first place.
pub fn redact(input: &str) -> String {
    let mut out = input.to_string();
    for re in PATTERNS.iter() {
        out = re.replace_all(&out, "[REDACTED]").into_owned();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn redacts_key_value_secrets() {
        assert_eq!(redact("password=hunter2"), "[REDACTED]");
        assert_eq!(redact("api_key: sk-abc123"), "[REDACTED]");
        assert!(!redact("Authorization: Bearer eyJabc.def").contains("eyJabc"));
    }

    #[test]
    fn redacts_pem_private_key() {
        let pem =
            "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAsecret\n-----END OPENSSH PRIVATE KEY-----";
        assert_eq!(redact(pem), "[REDACTED]");
    }

    #[test]
    fn leaves_ordinary_lines_untouched() {
        let line = "connecting to host example.com:22 as alice";
        assert_eq!(redact(line), line);
    }

    #[test]
    fn redacts_authorization_header_variants() {
        assert!(!redact("Authorization: Basic dXNlcjpwYXNz").contains("dXNlcjpwYXNz"));
        assert!(!redact("Authorization: rawtoken123").contains("rawtoken123"));
        assert!(!redact("bearer=abc123").contains("abc123"));
    }
}
