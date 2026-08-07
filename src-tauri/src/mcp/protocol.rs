use serde_json::{json, Value};

pub const PROTOCOL_VERSION: &str = "2025-06-18";

#[derive(Debug)]
pub struct Request {
    pub id: Option<Value>,
    pub method: String,
    pub params: Value,
}

pub fn success(id: Option<Value>, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub fn error(id: Option<Value>, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Err carries a ready-to-send JSON-RPC error response, so the caller never has
/// to construct one for a message it could not even parse.
pub fn parse_request(line: &str) -> Result<Request, Value> {
    let v: Value = serde_json::from_str(line).map_err(|_| error(None, -32700, "parse error"))?;
    let id = v.get("id").cloned().filter(|i| !i.is_null());
    let method = match v.get("method").and_then(|m| m.as_str()) {
        Some(m) => m.to_string(),
        None => return Err(error(id, -32600, "invalid request: no method")),
    };
    let params = v.get("params").cloned().unwrap_or_else(|| json!({}));
    Ok(Request { id, method, params })
}

pub fn initialize_result() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "voltius", "version": env!("CARGO_PKG_VERSION") },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_a_well_formed_request() {
        let req =
            parse_request(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#).unwrap();
        assert_eq!(req.method, "tools/list");
        assert_eq!(req.id, Some(json!(1)));
    }

    #[test]
    fn a_request_with_no_params_defaults_to_an_empty_object() {
        let req = parse_request(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#).unwrap();
        assert_eq!(req.params, json!({}));
    }

    #[test]
    fn a_notification_has_no_id() {
        let req =
            parse_request(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).unwrap();
        assert_eq!(req.id, None);
    }

    #[test]
    fn an_explicit_null_id_is_treated_as_a_notification() {
        // JSON-RPC discourages a null id for exactly this ambiguity; collapsing
        // it to "no reply" is deliberate, so it needs pinning.
        let req = parse_request(r#"{"jsonrpc":"2.0","id":null,"method":"tools/list"}"#).unwrap();
        assert_eq!(req.id, None);
    }

    #[test]
    fn malformed_json_yields_a_parse_error_response_not_a_panic() {
        let err = parse_request("{not json").unwrap_err();
        assert_eq!(err["error"]["code"], json!(-32700));
    }

    #[test]
    fn a_request_missing_method_is_an_invalid_request() {
        let err = parse_request(r#"{"jsonrpc":"2.0","id":1}"#).unwrap_err();
        assert_eq!(err["error"]["code"], json!(-32600));
    }

    #[test]
    fn initialize_advertises_the_tools_capability_and_server_name() {
        let r = initialize_result();
        assert_eq!(r["protocolVersion"], json!(PROTOCOL_VERSION));
        assert!(r["capabilities"]["tools"].is_object());
        assert_eq!(r["serverInfo"]["name"], json!("voltius"));
    }

    #[test]
    fn success_and_error_carry_the_request_id_back() {
        assert_eq!(success(Some(json!(7)), json!({"a":1}))["id"], json!(7));
        assert_eq!(error(Some(json!(7)), -32601, "nope")["id"], json!(7));
        assert_eq!(
            error(Some(json!(7)), -32601, "nope")["error"]["message"],
            json!("nope")
        );
    }
}
