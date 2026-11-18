use super::{accept_entry, parse, Issue, IssueKind, Layer, LoadedPolicy, PolicyDoc};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::Mutex;

pub const TYPED_KEYS: [(&str, &str); 3] = [
    ("enrollment_token", "enrollment.token"),
    ("server_url", "server.url"),
    ("server_allow_other", "server.allowOther"),
];

const POLICY_KEY: &str = "policy";
const MAX_KEY_UNITS: usize = 100;
const MAX_MESSAGE_UNITS: usize = 1000;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Error,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct FeedbackEntry {
    pub key: String,
    pub severity: Severity,
    pub message: String,
}

fn cut_utf16(s: &str, max: usize) -> String {
    let mut units = 0;
    s.chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= max
        })
        .collect()
}

pub fn feedback_entries(issues: &[Issue]) -> Vec<FeedbackEntry> {
    let mut groups: Vec<(String, Severity, Vec<&str>)> = Vec::new();
    for issue in issues {
        let key = issue.key.as_deref().unwrap_or(POLICY_KEY);
        let severity = match issue.kind {
            IssueKind::File | IssueKind::Type => Severity::Error,
            _ => Severity::Info,
        };
        match groups.iter_mut().find(|(k, _, _)| k == key) {
            Some((_, worst, messages)) => {
                *worst = (*worst).max(severity);
                messages.push(&issue.message);
            }
            None => groups.push((key.to_string(), severity, vec![&issue.message])),
        }
    }
    if groups.is_empty() {
        groups.push((POLICY_KEY.to_string(), Severity::Info, vec!["applied"]));
    }
    groups
        .into_iter()
        .map(|(key, severity, messages)| FeedbackEntry {
            key: cut_utf16(&key, MAX_KEY_UNITS),
            severity,
            message: cut_utf16(&messages.join("; "), MAX_MESSAGE_UNITS),
        })
        .collect()
}

pub fn load_managed(
    read: Result<Value, String>,
    last: &Mutex<Option<String>>,
    report: impl FnOnce(&str) -> Result<(), String>,
) -> LoadedPolicy {
    let (doc, issues) = match read {
        Ok(bundle) => managed_config_doc(&bundle),
        Err(e) => {
            log::warn!("{e}");
            (
                PolicyDoc::default(),
                vec![Issue::general(IssueKind::File, e)],
            )
        }
    };
    if let Ok(json) = serde_json::to_string(&feedback_entries(&issues)) {
        let mut last = last.lock().unwrap_or_else(|e| e.into_inner());
        if last.as_deref() != Some(json.as_str()) {
            match report(&json) {
                Ok(()) => *last = Some(json),
                Err(e) => log::warn!("{e}"),
            }
        }
    }
    LoadedPolicy {
        path: None,
        doc,
        issues,
    }
}

fn typed_issue(kind: IssueKind, id: &str, message: String) -> Issue {
    Issue::keyed(kind, Some(Layer::Policy), id, message)
}

fn typed_value(id: &str, raw: &Value) -> Result<Option<Value>, String> {
    if let (Value::Bool(_), "server.allowOther") = (raw, id) {
        return Ok(Some(raw.clone()));
    }
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

pub fn is_known_key(key: &str) -> bool {
    key == POLICY_KEY || TYPED_KEYS.iter().any(|(k, _)| *k == key)
}

pub fn managed_config_doc(bundle: &Value) -> (PolicyDoc, Vec<Issue>) {
    let mut issues = Vec::new();
    let mut doc = PolicyDoc::default();
    let Some(map) = bundle.as_object() else {
        return (doc, issues);
    };

    for key in map.keys() {
        if !is_known_key(key) {
            issues.push(Issue::keyed(
                IssueKind::UnknownKey,
                None,
                key,
                "unknown managed configuration key; ignored".to_string(),
            ));
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
    fn allow_other_accepts_a_json_bool() {
        for want in [true, false] {
            let (doc, issues) = managed_config_doc(&json!({"server_allow_other": want}));
            assert!(issues.is_empty(), "{issues:?}");
            assert_eq!(doc.policy["server.allowOther"], json!(want));
        }
    }

    #[test]
    fn stringified_non_choice_value_is_a_type_issue() {
        let (doc, issues) = managed_config_doc(&json!({"server_allow_other": "1"}));
        assert!(doc.policy.is_empty());
        assert_eq!(
            kinds(&issues),
            [(
                IssueKind::Type,
                Some(Layer::Policy),
                Some("server.allowOther")
            )]
        );
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

    fn run(
        read: Result<Value, String>,
        last: &Mutex<Option<String>>,
    ) -> (LoadedPolicy, Vec<String>) {
        let mut sent = Vec::new();
        let loaded = load_managed(read, last, |j| {
            sent.push(j.to_string());
            Ok(())
        });
        (loaded, sent)
    }

    fn payload(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn empty_read_reports_applied_once() {
        let last = Mutex::new(None);
        let (loaded, first) = run(Ok(json!({})), &last);
        let (_, second) = run(Ok(json!({})), &last);
        assert_eq!(first.len() + second.len(), 1);
        assert_eq!(
            payload(&first[0]),
            json!([{"key":"policy","severity":"info","message":"applied"}])
        );
        assert!(loaded.issues.is_empty());
        assert_eq!(loaded.doc, PolicyDoc::default());
    }

    #[test]
    fn read_error_is_one_file_issue() {
        let last = Mutex::new(None);
        let (loaded, sent) = run(Err("boom".into()), &last);
        assert_eq!(
            loaded.issues,
            vec![Issue::general(IssueKind::File, "boom".into())]
        );
        assert_eq!(
            payload(&sent[0]),
            json!([{"key":"policy","severity":"error","message":"boom"}])
        );
    }

    #[test]
    fn failed_report_is_retried() {
        let last = Mutex::new(None);
        let mut calls = 0;
        load_managed(Ok(json!({})), &last, |_| {
            calls += 1;
            Err("no".into())
        });
        assert!(last.lock().unwrap().is_none());
        let mut sent = None;
        load_managed(Ok(json!({})), &last, |j| {
            calls += 1;
            sent = Some(j.to_string());
            Ok(())
        });
        assert_eq!(calls, 2);
        assert_eq!(*last.lock().unwrap(), sent);
    }

    #[test]
    fn report_resent_after_change() {
        let last = Mutex::new(None);
        let (_, a) = run(Ok(json!({})), &last);
        let (_, b) = run(Ok(json!({"policy":"{nope"})), &last);
        assert_eq!(a.len() + b.len(), 2);
    }

    #[test]
    fn groups_by_key_with_worst_severity() {
        let issues = [
            Issue::keyed(IssueKind::UnknownKey, None, "a", "x".into()),
            Issue::keyed(IssueKind::Type, Some(Layer::Policy), "a", "y".into()),
            Issue::general(IssueKind::Conflict, "z".into()),
        ];
        let entry = |key: &str, severity, message: &str| FeedbackEntry {
            key: key.into(),
            severity,
            message: message.into(),
        };
        assert_eq!(
            feedback_entries(&issues),
            vec![
                entry("a", Severity::Error, "x; y"),
                entry("policy", Severity::Info, "z")
            ]
        );
    }

    #[test]
    fn cuts_key_and_message() {
        for (unit, key_len, msg_len) in [("k", 150, 1500), ("é", 150, 1500), ("😀", 150, 600)] {
            let issues = [Issue::keyed(
                IssueKind::UnknownKey,
                None,
                &unit.repeat(key_len),
                unit.repeat(msg_len),
            )];
            let out = feedback_entries(&issues);
            assert_eq!(out[0].key.encode_utf16().count(), 100);
            assert_eq!(out[0].message.encode_utf16().count(), 1000);
        }
    }

    #[test]
    fn cut_never_splits_a_surrogate_pair() {
        assert_eq!(cut_utf16("a😀", 2), "a");
        assert_eq!(cut_utf16("😀😀", 3), "😀");
    }

    #[test]
    fn number_and_null_values_are_type_issues() {
        let (doc, issues) = managed_config_doc(&json!({"server_url": 3, "enrollment_token": null}));
        assert_eq!(
            kinds(&issues),
            vec![
                (
                    IssueKind::Type,
                    Some(Layer::Policy),
                    Some("enrollment.token")
                ),
                (IssueKind::Type, Some(Layer::Policy), Some("server.url")),
            ]
        );
        assert!(doc.policy.is_empty());
    }
}
