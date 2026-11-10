use super::{accept_entry, parse, Issue, IssueKind, Layer, PolicyDoc};
use serde_json::Value;
use std::collections::BTreeMap;

pub const TYPED_KEYS: [(&str, &str); 3] = [
    ("enrollment_token", "enrollment.token"),
    ("server_url", "server.url"),
    ("server_allow_other", "server.allowOther"),
];

const POLICY_KEY: &str = "policy";

fn typed_issue(kind: IssueKind, id: &str, message: String) -> Issue {
    Issue {
        kind,
        layer: Some(Layer::Policy),
        key: Some(id.to_string()),
        message,
    }
}

fn typed_value(id: &str, raw: &Value) -> Result<Option<Value>, String> {
    let Some(s) = raw.as_str() else {
        return Err("must be a string; ignored".to_string());
    };
    Ok(match (id, s) {
        (_, "") => None,
        ("server.allowOther", "true") => Some(Value::Bool(true)),
        ("server.allowOther", "false") => Some(Value::Bool(false)),
        ("server.allowOther", _) => return Err("must be \"true\" or \"false\"; ignored".into()),
        _ => Some(Value::String(s.to_string())),
    })
}

pub fn managed_config_doc(bundle: &Value) -> (PolicyDoc, Vec<Issue>) {
    let mut issues = Vec::new();
    let mut doc = PolicyDoc::default();
    let Some(map) = bundle.as_object() else {
        return (doc, issues);
    };

    for key in map.keys() {
        if key != POLICY_KEY && !TYPED_KEYS.iter().any(|(k, _)| k == key) {
            issues.push(Issue {
                kind: IssueKind::UnknownKey,
                layer: None,
                key: Some(key.clone()),
                message: "unknown managed configuration key; ignored".to_string(),
            });
        }
    }

    match map.get(POLICY_KEY) {
        None => {}
        Some(Value::String(text)) if text.is_empty() => {}
        Some(Value::String(text)) => {
            let (parsed, found) = parse(text);
            doc = parsed;
            issues.extend(found);
        }
        Some(_) => issues.push(Issue::general(
            IssueKind::File,
            "\"policy\" must be a string; ignored".to_string(),
        )),
    }

    for (restriction, id) in TYPED_KEYS {
        let Some(raw) = map.get(restriction) else {
            continue;
        };
        let value = match typed_value(id, raw) {
            Ok(Some(v)) => v,
            Ok(None) => continue,
            Err(m) => {
                issues.push(typed_issue(IssueKind::Type, id, m));
                continue;
            }
        };
        let mut accepted = BTreeMap::new();
        accept_entry(Layer::Policy, id, &value, &mut accepted, &mut issues);
        let Some(value) = accepted.remove(id) else {
            continue;
        };
        if doc.policy.get(id).is_some_and(|json| *json != value) {
            issues.push(typed_issue(
                IssueKind::Conflict,
                id,
                format!("{restriction} overrides the value in \"policy\""),
            ));
        }
        doc.policy.insert(id.to_string(), value);
    }
    (doc, issues)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const TOKEN: &str = "vte1.aHR0cHM6Ly9hcGkudm9sdGl1cy5hcHA.0123456789abcdef0123456789abcdef.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop-";

    fn kinds(issues: &[Issue]) -> Vec<(IssueKind, Option<Layer>, Option<&str>)> {
        issues
            .iter()
            .map(|i| (i.kind, i.layer, i.key.as_deref()))
            .collect()
    }

    #[test]
    fn empty_bundle_is_empty() {
        assert_eq!(
            managed_config_doc(&json!({})),
            (PolicyDoc::default(), vec![])
        );
    }

    #[test]
    fn blank_bundle_is_empty() {
        let b = json!({"enrollment_token":"","server_url":"","server_allow_other":"","policy":""});
        assert_eq!(managed_config_doc(&b), (PolicyDoc::default(), vec![]));
    }

    #[test]
    fn typed_keys_map_to_policy_ids() {
        let b = json!({"server_url":"https://a.example","server_allow_other":"false","enrollment_token":TOKEN});
        let (doc, issues) = managed_config_doc(&b);
        assert!(issues.is_empty(), "{issues:?}");
        let want: BTreeMap<String, Value> = [
            ("server.url", json!("https://a.example")),
            ("server.allowOther", json!(false)),
            ("enrollment.token", json!(TOKEN)),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
        assert_eq!(doc.policy, want);
    }

    #[test]
    fn json_policy_parsed() {
        let text = r#"{"version":1,"policy":{"sshConfig.import":false},"defaults":{"appSettings.locale":"fr"}}"#;
        let (doc, issues) = managed_config_doc(&json!({"policy": text}));
        assert!(issues.is_empty(), "{issues:?}");
        assert_eq!(doc.policy["sshConfig.import"], json!(false));
        assert_eq!(doc.defaults["appSettings.locale"], json!("fr"));
    }

    fn url_policy(url: &str) -> String {
        json!({"version":1,"policy":{"server.url":url}}).to_string()
    }

    #[test]
    fn typed_and_json_agree() {
        let b =
            json!({"policy": url_policy("https://a.example"), "server_url":"https://a.example"});
        let (doc, issues) = managed_config_doc(&b);
        assert!(issues.is_empty(), "{issues:?}");
        assert_eq!(doc.policy.len(), 1);
    }

    #[test]
    fn typed_beats_json_with_conflict() {
        let b =
            json!({"policy": url_policy("https://b.example"), "server_url":"https://a.example"});
        let (doc, issues) = managed_config_doc(&b);
        assert_eq!(doc.policy["server.url"], json!("https://a.example"));
        assert_eq!(
            kinds(&issues),
            vec![(IssueKind::Conflict, Some(Layer::Policy), Some("server.url"))]
        );
    }

    #[test]
    fn invalid_json_policy() {
        let (doc, issues) =
            managed_config_doc(&json!({"policy":"{nope","server_url":"https://a.example"}));
        assert_eq!(kinds(&issues), vec![(IssueKind::File, None, None)]);
        assert_eq!(doc.policy["server.url"], json!("https://a.example"));
    }

    #[test]
    fn bad_typed_key_keeps_json() {
        let b = json!({
            "enrollment_token": "nope",
            "policy": json!({"version":1,"policy":{"sshConfig.import":false}}).to_string(),
        });
        let (doc, issues) = managed_config_doc(&b);
        assert_eq!(
            kinds(&issues),
            vec![(
                IssueKind::Type,
                Some(Layer::Policy),
                Some("enrollment.token")
            )]
        );
        assert_eq!(doc.policy["sshConfig.import"], json!(false));
        assert!(!doc.policy.contains_key("enrollment.token"));
    }

    #[test]
    fn allow_other_bad_choice() {
        let (doc, issues) = managed_config_doc(&json!({"server_allow_other":"yes"}));
        assert_eq!(
            kinds(&issues),
            vec![(
                IssueKind::Type,
                Some(Layer::Policy),
                Some("server.allowOther")
            )]
        );
        assert!(!doc.policy.contains_key("server.allowOther"));
    }

    #[test]
    fn unknown_bundle_key() {
        let (_, issues) = managed_config_doc(&json!({"foo":"x"}));
        assert_eq!(
            kinds(&issues),
            vec![(IssueKind::UnknownKey, None, Some("foo"))]
        );
    }

    #[test]
    fn wrong_java_type() {
        let (_, issues) = managed_config_doc(&json!({"server_url": true}));
        assert_eq!(
            kinds(&issues),
            vec![(IssueKind::Type, Some(Layer::Policy), Some("server.url"))]
        );
    }
}
