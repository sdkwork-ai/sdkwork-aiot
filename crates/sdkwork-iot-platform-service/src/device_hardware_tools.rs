//! Live hardware tool catalog for an online Xiaozhi device.
//!
//! The device edge runtime owns the protocol session and caches the MCP tools
//! discovered from each connected device. The admin backend must not duplicate
//! that state, so it queries the edge runtime through its internal endpoint and
//! exposes a stable admin-facing view. When the device is offline (or the edge
//! runtime answers 404) the catalog is reported as `online: false` with no
//! tools instead of failing the admin page.

use std::time::Duration;

use sdkwork_utils_rust::url_encode;
use serde_json::Value;

pub const ENV_EDGE_DEVICE_INGRESS_HTTP_URL: &str = "SDKWORK_AIOT_EDGE_DEVICE_INGRESS_HTTP_URL";
pub const ENV_INTERNAL_TOKEN: &str = "SDKWORK_AIOT_INTERNAL_TOKEN";
pub const ENV_HARDWARE_TOOLS_TIMEOUT_MS: &str = "SDKWORK_AIOT_HARDWARE_TOOLS_TIMEOUT_MS";
pub const DEFAULT_EDGE_DEVICE_INGRESS_HTTP_URL: &str = "http://127.0.0.1:18080";
pub const DEFAULT_HARDWARE_TOOLS_TIMEOUT_MS: u64 = 1_500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiotDeviceHardwareTool {
    pub name: String,
    pub description: String,
    pub input_schema_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiotDeviceHardwareToolCatalog {
    pub device_id: String,
    pub online: bool,
    pub discovered: bool,
    pub tools: Vec<AiotDeviceHardwareTool>,
}

impl AiotDeviceHardwareToolCatalog {
    pub fn offline(device_id: &str) -> Self {
        Self {
            device_id: device_id.to_string(),
            online: false,
            discovered: false,
            tools: Vec::new(),
        }
    }

    pub fn resource_json(&self) -> String {
        let tools = self
            .tools
            .iter()
            .map(|tool| {
                format!(
                    r#"{{"name":"{}","description":"{}","inputSchema":{}}}"#,
                    json_escape(&tool.name),
                    json_escape(&tool.description),
                    normalize_schema(&tool.input_schema_json)
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        format!(
            r#"{{"deviceId":"{}","online":{},"discovered":{},"tools":[{}]}}"#,
            json_escape(&self.device_id),
            self.online,
            self.discovered,
            tools
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiotDeviceHardwareToolError {
    Unavailable(String),
    InvalidResponse(String),
    NotFound(String),
    Timeout(String),
    InvalidArguments(String),
    DeviceError(String),
}

pub trait AiotDeviceHardwareToolSource: Send + Sync {
    fn list_hardware_tools(
        &self,
        device_id: &str,
    ) -> Result<AiotDeviceHardwareToolCatalog, AiotDeviceHardwareToolError>;

    fn invoke_tool(
        &self,
        _device_id: &str,
        _tool_name: &str,
        _arguments_json: &str,
    ) -> Result<Value, AiotDeviceHardwareToolError> {
        Err(AiotDeviceHardwareToolError::Unavailable(
            "hardware tool invocation is not configured".to_string(),
        ))
    }
}

#[derive(Debug, Clone)]
pub struct EdgeRuntimeHardwareToolSource {
    base_url: String,
    internal_token: Option<String>,
    timeout: Duration,
}

impl EdgeRuntimeHardwareToolSource {
    pub fn from_env() -> Self {
        let base_url = std::env::var(ENV_EDGE_DEVICE_INGRESS_HTTP_URL)
            .ok()
            .map(|value| value.trim().trim_end_matches('/').to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_EDGE_DEVICE_INGRESS_HTTP_URL.to_string());
        let internal_token = std::env::var(ENV_INTERNAL_TOKEN)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let timeout = Duration::from_millis(
            std::env::var(ENV_HARDWARE_TOOLS_TIMEOUT_MS)
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .filter(|value| *value > 0)
                .unwrap_or(DEFAULT_HARDWARE_TOOLS_TIMEOUT_MS),
        );
        Self {
            base_url,
            internal_token,
            timeout,
        }
    }

    pub fn new(
        base_url: impl Into<String>,
        internal_token: Option<String>,
        timeout: Duration,
    ) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            internal_token,
            timeout,
        }
    }
}

impl AiotDeviceHardwareToolSource for EdgeRuntimeHardwareToolSource {
    fn list_hardware_tools(
        &self,
        device_id: &str,
    ) -> Result<AiotDeviceHardwareToolCatalog, AiotDeviceHardwareToolError> {
        let url = format!(
            "{}/internal/xiaozhi/mcp_tools?device_id={}",
            self.base_url,
            url_encode(device_id)
        );
        let agent = ureq::AgentBuilder::new().timeout(self.timeout).build();
        let mut request = agent.get(&url);
        if let Some(token) = self.internal_token.as_deref() {
            request = request.set("x-sdkwork-internal-token", token);
        }
        match request.call() {
            Ok(response) => {
                let body = response
                    .into_string()
                    .map_err(|error| AiotDeviceHardwareToolError::Unavailable(error.to_string()))?;
                parse_hardware_tool_catalog(device_id, &body)
            }
            Err(ureq::Error::Status(404, _)) => {
                Ok(AiotDeviceHardwareToolCatalog::offline(device_id))
            }
            Err(ureq::Error::Status(status, _)) => Err(AiotDeviceHardwareToolError::Unavailable(
                format!("edge runtime hardware tool query failed with status {status}"),
            )),
            Err(error) => Err(AiotDeviceHardwareToolError::Unavailable(error.to_string())),
        }
    }

    fn invoke_tool(
        &self,
        device_id: &str,
        tool_name: &str,
        arguments_json: &str,
    ) -> Result<Value, AiotDeviceHardwareToolError> {
        let arguments: Value = serde_json::from_str(arguments_json)
            .map_err(|error| AiotDeviceHardwareToolError::InvalidArguments(error.to_string()))?;
        if !arguments.is_object() {
            return Err(AiotDeviceHardwareToolError::InvalidArguments(
                "tool arguments must be a JSON object".to_string(),
            ));
        }
        let body = serde_json::json!({
            "deviceId": device_id,
            "toolName": tool_name,
            "arguments": arguments,
        })
        .to_string();
        let url = format!("{}/internal/xiaozhi/mcp_tools/call", self.base_url);
        let agent = ureq::AgentBuilder::new().timeout(self.timeout).build();
        let mut request = agent.post(&url).set("content-type", "application/json");
        if let Some(token) = self.internal_token.as_deref() {
            request = request.set("x-sdkwork-internal-token", token);
        }
        match request.send_string(&body) {
            Ok(response) => {
                let body = response
                    .into_string()
                    .map_err(|error| AiotDeviceHardwareToolError::Unavailable(error.to_string()))?;
                let value: Value = serde_json::from_str(&body).map_err(|error| {
                    AiotDeviceHardwareToolError::InvalidResponse(error.to_string())
                })?;
                Ok(value.get("result").cloned().unwrap_or(Value::Null))
            }
            Err(ureq::Error::Status(404, _)) => Err(AiotDeviceHardwareToolError::NotFound(
                "device or MCP tool was not found".to_string(),
            )),
            Err(ureq::Error::Status(408 | 504, _)) => Err(AiotDeviceHardwareToolError::Timeout(
                "edge runtime timed out waiting for the device".to_string(),
            )),
            Err(ureq::Error::Status(422, _)) => Err(AiotDeviceHardwareToolError::InvalidArguments(
                "device rejected the tool arguments".to_string(),
            )),
            Err(ureq::Error::Status(502, _)) => Err(AiotDeviceHardwareToolError::DeviceError(
                "device returned an MCP error".to_string(),
            )),
            Err(ureq::Error::Status(status, _)) => Err(AiotDeviceHardwareToolError::Unavailable(
                format!("edge runtime tool call failed with status {status}"),
            )),
            Err(error) => Err(AiotDeviceHardwareToolError::Unavailable(error.to_string())),
        }
    }
}

fn parse_hardware_tool_catalog(
    device_id: &str,
    body: &str,
) -> Result<AiotDeviceHardwareToolCatalog, AiotDeviceHardwareToolError> {
    let value: Value = serde_json::from_str(body)
        .map_err(|error| AiotDeviceHardwareToolError::InvalidResponse(error.to_string()))?;
    let discovered = value
        .get("discovered")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let tools = value
        .get("tools")
        .and_then(Value::as_array)
        .map(|tools| {
            tools
                .iter()
                .filter_map(|tool| {
                    let name = tool.get("name").and_then(Value::as_str)?.trim();
                    if name.is_empty() {
                        return None;
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
                    Some(AiotDeviceHardwareTool {
                        name: name.to_string(),
                        description,
                        input_schema_json,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(AiotDeviceHardwareToolCatalog {
        device_id: device_id.to_string(),
        online: true,
        discovered,
        tools,
    })
}

fn normalize_schema(input_schema_json: &str) -> String {
    match serde_json::from_str::<Value>(input_schema_json) {
        Ok(Value::Object(map)) => Value::Object(map).to_string(),
        _ => "{}".to_string(),
    }
}

fn json_escape(input: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_discovered_tool_catalog() {
        let catalog = parse_hardware_tool_catalog(
            "dev-001",
            r#"{"sessionId":"s1","discovered":true,"tools":[{"name":"self.audio_speaker.set_volume","description":"Set volume","inputSchema":{"type":"object"}},{"name":"self.camera.take_photo","description":"Take photo"}]}"#,
        )
        .expect("catalog");
        assert!(catalog.online);
        assert!(catalog.discovered);
        assert_eq!(catalog.tools.len(), 2);
        assert_eq!(catalog.tools[0].name, "self.audio_speaker.set_volume");
        assert_eq!(catalog.tools[0].input_schema_json, r#"{"type":"object"}"#);
    }

    #[test]
    fn offline_catalog_has_no_tools() {
        let catalog = AiotDeviceHardwareToolCatalog::offline("dev-002");
        assert!(!catalog.online);
        assert!(catalog.tools.is_empty());
        assert_eq!(
            catalog.resource_json(),
            r#"{"deviceId":"dev-002","online":false,"discovered":false,"tools":[]}"#
        );
    }

    #[test]
    fn resource_json_preserves_schema_and_escapes_text() {
        let catalog = AiotDeviceHardwareToolCatalog {
            device_id: "dev-003".to_string(),
            online: true,
            discovered: true,
            tools: vec![AiotDeviceHardwareTool {
                name: "self.light.turn_on".to_string(),
                description: "turn \"on\"".to_string(),
                input_schema_json: r#"{"type":"object","properties":{}}"#.to_string(),
            }],
        };
        let json = catalog.resource_json();
        assert!(json.contains(r#""name":"self.light.turn_on""#));
        assert!(json.contains(r#""description":"turn \"on\"""#));
        assert!(json.contains(r#""inputSchema":{"properties":{},"type":"object"}"#));
    }
}
