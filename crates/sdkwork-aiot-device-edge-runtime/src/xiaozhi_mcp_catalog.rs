//! Xiaozhi MCP tool discovery over an active device session.
//!
//! After the server hello, the backend acts as the MCP client: it sends
//! `initialize`, then pages through `tools/list`, and caches every tool the
//! device exposes (audio, screen, camera, board-specific actuators). The cached
//! catalog is what lets the platform map smart-hardware capabilities to concrete
//! device tools without hard-coding a board list.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct XiaozhiMcpTool {
    pub name: String,
    pub description: String,
    pub input_schema_json: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PendingKind {
    Initialize,
    ToolsList,
}

#[derive(Debug, Clone)]
struct PendingRequest {
    id: String,
    kind: PendingKind,
}

#[derive(Debug, Default)]
struct SessionDiscovery {
    discovered: bool,
    pending: Option<PendingRequest>,
    tools: BTreeMap<String, XiaozhiMcpTool>,
}

fn store() -> &'static Mutex<BTreeMap<String, SessionDiscovery>> {
    static STORE: OnceLock<Mutex<BTreeMap<String, SessionDiscovery>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(BTreeMap::new()))
}

static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

/// Allocates a JSON-RPC request id for one discovery exchange.
pub fn next_request_id() -> u64 {
    NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed)
}

/// Registers the `initialize` request sent with the server hello.
pub fn begin_initialize(session_id: &str, request_id: u64) {
    if let Ok(mut guard) = store().lock() {
        let entry = guard.entry(session_id.to_string()).or_default();
        entry.discovered = false;
        entry.tools.clear();
        entry.pending = Some(PendingRequest {
            id: request_id.to_string(),
            kind: PendingKind::Initialize,
        });
    }
}

/// Drops discovery state for a closed session.
pub fn clear_session(session_id: &str) {
    if let Ok(mut guard) = store().lock() {
        guard.remove(session_id);
    }
}

/// Cached tools discovered for an active session.
pub fn session_tools(session_id: &str) -> Vec<XiaozhiMcpTool> {
    store()
        .lock()
        .ok()
        .and_then(|guard| {
            guard
                .get(session_id)
                .map(|entry| entry.tools.values().cloned().collect())
        })
        .unwrap_or_default()
}

/// True once the last `tools/list` page has been consumed.
pub fn discovery_complete(session_id: &str) -> bool {
    store()
        .lock()
        .ok()
        .and_then(|guard| guard.get(session_id).map(|entry| entry.discovered))
        .unwrap_or(false)
}

/// Handles one inbound MCP message.
///
/// Returns the next discovery request payload (without the `type:"mcp"` wrapper)
/// when the backend should continue paging, or `None` when the exchange is done
/// or the message is unrelated to discovery.
pub fn on_mcp_message(
    session_id: &str,
    kind: &str,
    id_json: Option<&str>,
    payload_json: &str,
) -> Option<String> {
    if kind != "response" && kind != "error" {
        return None;
    }
    let frame: Value = serde_json::from_str(payload_json).ok()?;
    let payload = frame.get("payload").cloned().unwrap_or(frame);
    let response_id = payload
        .get("id")
        .map(json_id_literal)
        .or_else(|| id_json.map(str::to_string));

    let pending = {
        let mut guard = store().lock().ok()?;
        let entry = guard.get_mut(session_id)?;
        let pending = entry.pending.clone()?;
        if !response_id.is_some_and(|id| id == pending.id) {
            return None;
        }
        entry.pending = None;
        if kind == "error" {
            return None;
        }
        pending
    };

    match pending.kind {
        PendingKind::Initialize => {
            let next_id = next_request_id();
            {
                let mut guard = store().lock().ok()?;
                if let Some(entry) = guard.get_mut(session_id) {
                    entry.pending = Some(PendingRequest {
                        id: next_id.to_string(),
                        kind: PendingKind::ToolsList,
                    });
                }
            }
            Some(tools_list_request(next_id, ""))
        }
        PendingKind::ToolsList => {
            let result = payload.get("result");
            record_tools(session_id, result);
            let next_cursor = result
                .and_then(|value| value.get("nextCursor"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if next_cursor.is_empty() {
                if let Ok(mut guard) = store().lock() {
                    if let Some(entry) = guard.get_mut(session_id) {
                        entry.discovered = true;
                    }
                }
                return None;
            }
            let next_id = next_request_id();
            {
                let mut guard = store().lock().ok()?;
                if let Some(entry) = guard.get_mut(session_id) {
                    entry.pending = Some(PendingRequest {
                        id: next_id.to_string(),
                        kind: PendingKind::ToolsList,
                    });
                }
            }
            Some(tools_list_request(next_id, &next_cursor))
        }
    }
}

fn tools_list_request(request_id: u64, cursor: &str) -> String {
    let cursor_param = if cursor.is_empty() {
        String::new()
    } else {
        format!(
            r#","cursor":{}"#,
            serde_json::to_string(cursor).unwrap_or_else(|_| "\"\"".to_string())
        )
    };
    format!(
        r#"{{"jsonrpc":"2.0","id":{request_id},"method":"tools/list","params":{{"withUserTools":true{cursor_param}}}}}"#
    )
}

fn record_tools(session_id: &str, result: Option<&Value>) {
    let Some(tools) = result
        .and_then(|value| value.get("tools"))
        .and_then(Value::as_array)
    else {
        return;
    };
    let Ok(mut guard) = store().lock() else {
        return;
    };
    let Some(entry) = guard.get_mut(session_id) else {
        return;
    };
    for tool in tools {
        let Some(tool_name) = tool.get("name").and_then(Value::as_str) else {
            continue;
        };
        if tool_name.trim().is_empty() {
            continue;
        }
        let description = tool
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let input_schema_json = tool
            .get("inputSchema")
            .map(Value::to_string)
            .unwrap_or_else(|| "{}".to_string());
        entry.tools.insert(
            tool_name.to_string(),
            XiaozhiMcpTool {
                name: tool_name.to_string(),
                description,
                input_schema_json,
            },
        );
    }
}

fn json_id_literal(value: &Value) -> String {
    match value {
        Value::String(text) => format!("\"{}\"", escape_json(text)),
        other => other.to_string(),
    }
}

fn escape_json(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    for character in input.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            other => output.push(other),
        }
    }
    output
}

/// Serializes the cached catalog for internal/operator HTTP responses.
pub fn session_tools_json(session_id: &str) -> String {
    let tools = session_tools(session_id)
        .into_iter()
        .map(|tool| {
            let mut object = Map::new();
            object.insert("name".to_string(), Value::String(tool.name));
            object.insert("description".to_string(), Value::String(tool.description));
            object.insert(
                "inputSchema".to_string(),
                serde_json::from_str(&tool.input_schema_json)
                    .unwrap_or_else(|_| Value::Object(Map::new())),
            );
            Value::Object(object)
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "sessionId": session_id,
        "discovered": discovery_complete(session_id),
        "tools": tools,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_pages_initialize_then_tools_and_caches_catalog() {
        let session = "mcp-discovery-pagination";
        clear_session(session);
        let init_id = next_request_id();
        begin_initialize(session, init_id);

        let init_response = format!(
            r#"{{"jsonrpc":"2.0","id":{init_id},"result":{{"protocolVersion":"2024-11-05","capabilities":{{}}}}}}"#
        );
        let next = on_mcp_message(session, "response", None, &init_response)
            .expect("tools/list follow-up");
        assert!(next.contains(r#""method":"tools/list""#));
        assert!(next.contains(r#""withUserTools":true"#));

        let list_id = extract_id(&next);
        let page_one = format!(
            r#"{{"jsonrpc":"2.0","id":{list_id},"result":{{"tools":[{{"name":"self.audio_speaker.set_volume","description":"Set volume","inputSchema":{{"type":"object"}}}}],"nextCursor":"page-2"}}}}"#
        );
        let page_two_request =
            on_mcp_message(session, "response", None, &page_one).expect("second page request");
        assert!(page_two_request.contains(r#""cursor":"page-2""#));

        let page_two_id = extract_id(&page_two_request);
        let page_two = format!(
            r#"{{"jsonrpc":"2.0","id":{page_two_id},"result":{{"tools":[{{"name":"self.camera.take_photo","description":"Take a photo"}}]}}}}"#
        );
        assert!(on_mcp_message(session, "response", None, &page_two).is_none());
        assert!(discovery_complete(session));

        let tools = session_tools(session);
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "self.audio_speaker.set_volume");
        assert_eq!(tools[1].name, "self.camera.take_photo");
        clear_session(session);
    }

    #[test]
    fn mismatched_or_error_responses_do_not_advance_discovery() {
        let session = "mcp-discovery-mismatch";
        clear_session(session);
        begin_initialize(session, 7);

        assert!(on_mcp_message(
            session,
            "response",
            None,
            r#"{"jsonrpc":"2.0","id":99,"result":{}}"#,
        )
        .is_none());
        assert!(on_mcp_message(
            session,
            "error",
            None,
            r#"{"jsonrpc":"2.0","id":7,"error":{"code":-32601,"message":"unsupported"}}"#,
        )
        .is_none());
        assert!(!discovery_complete(session));
        assert!(session_tools(session).is_empty());
        clear_session(session);
    }

    #[test]
    fn session_tools_json_exposes_schema_and_state() {
        let session = "mcp-discovery-json";
        clear_session(session);
        begin_initialize(session, 1);
        let next = on_mcp_message(
            session,
            "response",
            None,
            r#"{"jsonrpc":"2.0","id":1,"result":{}}"#,
        )
        .expect("list");
        let list_id = extract_id(&next);
        let page = format!(
            r#"{{"jsonrpc":"2.0","id":{list_id},"result":{{"tools":[{{"name":"self.light.turn_on","description":"Turn on","inputSchema":{{"type":"object"}}}}]}}}}"#
        );
        assert!(on_mcp_message(session, "response", None, &page).is_none());

        let value: Value = serde_json::from_str(&session_tools_json(session)).expect("json");
        assert_eq!(value["discovered"], Value::Bool(true));
        assert_eq!(
            value["tools"][0]["name"],
            Value::String("self.light.turn_on".to_string())
        );
        clear_session(session);
    }

    fn extract_id(request: &str) -> u64 {
        request
            .split(r#""id":"#)
            .nth(1)
            .and_then(|tail| tail.split([',', '}']).next())
            .and_then(|value| value.parse::<u64>().ok())
            .expect("request id")
    }
}
