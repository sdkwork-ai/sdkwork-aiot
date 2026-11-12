//! Server-initiated MCP `tools/call` for a live Xiaozhi WebSocket session.
//!
//! The backend sends a JSON-RPC request through the session's outbound channel,
//! then waits for the device's correlated `response`/`error` frame. The wait is
//! bounded so an unresponsive device cannot pin an admin request thread.

use std::collections::HashMap;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};

use crate::active_ws_sessions::push_ws_command_replies;
use crate::xiaozhi_mcp_catalog::next_request_id;
use crate::WebSocketSessionReply;

pub const DEFAULT_TOOL_INVOKE_TIMEOUT_MS: u64 = 10_000;
pub const MAX_TOOL_INVOKE_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum XiaozhiToolInvokeError {
    Offline,
    ToolNotFound,
    Timeout,
    InvalidArguments(String),
    DeviceError(String),
    Transport(String),
}

impl XiaozhiToolInvokeError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Offline => "iot.xiaozhi.mcp_tool.offline",
            Self::ToolNotFound => "iot.xiaozhi.mcp_tool.not_found",
            Self::Timeout => "iot.xiaozhi.mcp_tool.timeout",
            Self::InvalidArguments(_) => "iot.xiaozhi.mcp_tool.invalid_arguments",
            Self::DeviceError(_) => "iot.xiaozhi.mcp_tool.device_error",
            Self::Transport(_) => "iot.xiaozhi.mcp_tool.transport",
        }
    }

    pub fn detail(&self) -> String {
        match self {
            Self::Offline => "device has no active protocol session".to_string(),
            Self::ToolNotFound => "device did not expose the requested MCP tool".to_string(),
            Self::Timeout => "device did not answer the MCP tool call in time".to_string(),
            Self::InvalidArguments(message)
            | Self::DeviceError(message)
            | Self::Transport(message) => message.clone(),
        }
    }
}

fn pending() -> &'static Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>> =
        OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn pending_key(device_id: &str, request_id: &str) -> String {
    format!("{device_id}:{request_id}")
}

/// Invokes one MCP tool on the device and waits for its JSON-RPC response.
pub fn invoke_tool(
    device_id: &str,
    session_id: &str,
    tool_name: &str,
    arguments_json: &str,
    timeout_ms: u64,
) -> Result<Value, XiaozhiToolInvokeError> {
    let tool_name = tool_name.trim();
    if tool_name.is_empty() {
        return Err(XiaozhiToolInvokeError::ToolNotFound);
    }
    let arguments: Value = if arguments_json.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(arguments_json)
            .map_err(|error| XiaozhiToolInvokeError::InvalidArguments(error.to_string()))?
    };
    if !arguments.is_object() {
        return Err(XiaozhiToolInvokeError::InvalidArguments(
            "tool arguments must be a JSON object".to_string(),
        ));
    }
    let tools = crate::xiaozhi_mcp_session_tools(session_id);
    if !tools.iter().any(|tool| tool.name == tool_name) {
        return Err(XiaozhiToolInvokeError::ToolNotFound);
    }

    let request_id = next_request_id();
    let key = pending_key(device_id, &request_id.to_string());
    let (sender, receiver) = mpsc::channel();
    {
        let mut guard = pending().lock().map_err(|_| {
            XiaozhiToolInvokeError::Transport("pending tool map poisoned".to_string())
        })?;
        guard.insert(key.clone(), sender);
    }

    let payload = json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments,
        }
    });
    let frame = json!({
        "session_id": session_id,
        "type": "mcp",
        "payload": payload,
    })
    .to_string();
    if !push_ws_command_replies(device_id, vec![WebSocketSessionReply::Text(frame)]) {
        remove_pending(&key);
        return Err(XiaozhiToolInvokeError::Offline);
    }

    let timeout = Duration::from_millis(timeout_ms.clamp(1, MAX_TOOL_INVOKE_TIMEOUT_MS));
    match receiver.recv_timeout(timeout) {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(message)) => Err(XiaozhiToolInvokeError::DeviceError(message)),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            remove_pending(&key);
            Err(XiaozhiToolInvokeError::Timeout)
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            remove_pending(&key);
            Err(XiaozhiToolInvokeError::Offline)
        }
    }
}

/// Completes a pending invocation when the correlated MCP frame arrives.
///
/// Returns `true` when the frame belonged to a server-initiated tool call.
pub fn complete_tool_call(
    device_id: &str,
    id_json: Option<&str>,
    kind: &str,
    payload_json: &str,
) -> bool {
    if kind != "response" && kind != "error" {
        return false;
    }
    let Ok(frame) = serde_json::from_str::<Value>(payload_json) else {
        return false;
    };
    let payload = frame.get("payload").cloned().unwrap_or(frame);
    let request_id = payload
        .get("id")
        .map(|value| match value {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        })
        .or_else(|| id_json.map(normalize_id));
    let Some(request_id) = request_id else {
        return false;
    };
    let key = pending_key(device_id, &request_id);
    let Ok(mut guard) = pending().lock() else {
        return false;
    };
    let Some(sender) = guard.remove(&key) else {
        return false;
    };
    let result = if kind == "error" {
        let message = payload
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("device returned an MCP error")
            .to_string();
        Err(message)
    } else {
        Ok(payload.get("result").cloned().unwrap_or(Value::Null))
    };
    sender.send(result).is_ok()
}

fn normalize_id(value: &str) -> String {
    value.trim().trim_matches('"').to_string()
}

fn remove_pending(key: &str) {
    if let Ok(mut guard) = pending().lock() {
        guard.remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incomplete_or_unrelated_frames_do_not_complete_calls() {
        assert!(!complete_tool_call("dev-x", Some("1"), "request", "{}"));
        assert!(!complete_tool_call("dev-x", Some("1"), "response", "{}"));
    }

    #[test]
    fn invalid_arguments_are_rejected_before_transport() {
        let error = invoke_tool(
            "dev-x",
            "session-x",
            "self.audio_speaker.set_volume",
            r#"[1,2]"#,
            100,
        )
        .expect_err("non-object arguments");
        assert!(matches!(
            error,
            XiaozhiToolInvokeError::ToolNotFound | XiaozhiToolInvokeError::InvalidArguments(_)
        ));
    }
}
