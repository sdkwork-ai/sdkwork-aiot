# Device Hardware Tools (MCP Catalog)

Status: ready
Owner: SDKWork maintainers
Last updated: 2026-11-12

## Purpose

Xiaozhi devices expose their physical capabilities as MCP tools
(`self.audio_speaker.set_volume`, `self.camera.take_photo`,
`self.led_strip.set_brightness`, board-specific actuators). The edge runtime
discovers that catalog from the live protocol session; the admin console shows
it so an operator can confirm what a device actually reports before configuring
or automating it.

The catalog is discoverable and each tool can be invoked explicitly with a JSON
argument object. Invocation is user-initiated from the admin console; the
backend never calls device tools implicitly.

## Data Flow

```
device WS session
  -> edge runtime: initialize + paged tools/list (MCP)
  -> edge runtime cache (per session)
  -> GET /internal/xiaozhi/mcp_tools?device_id=...
  -> platform service: GET /backend/v3/api/iot/devices/{deviceId}/hardware_tools
  -> generated backend SDK: client.iot.devices.hardwareTools.list(deviceId)
  -> PC admin: DeviceHardwareToolsPanel

PC admin -> platform service: POST /backend/v3/api/iot/devices/{deviceId}/hardware_tool_calls/execute
  -> edge runtime -> device: tools/call
  -> correlated MCP response -> platform API -> PC panel result
```

The platform service never owns protocol session state. It validates the device
against the tenant-scoped repository, then queries the edge runtime with a
short timeout (default 1500 ms).

## Discovery API Contract

- Method/path: `GET /backend/v3/api/iot/devices/{deviceId}/hardware_tools`
- Operation id: `devices.hardwareTools.list`
- Permission: `iot.devices.read`
- Envelope: `{code:0,data:{item:{deviceId,online,discovered,tools[]}},traceId}`
- Tool shape: `{name,description,inputSchema}` where `inputSchema` is the raw
  MCP JSON schema.

Behavior:

- Online device with discovered tools: `online=true`, `discovered=true`, tools
  populated.
- Online device still discovering or without MCP: `online=true`,
  `discovered=false`, empty tools (HTTP 200).
- No active session: the edge runtime answers 404 and the backend returns
  `online=false`, empty tools (HTTP 200), so the admin page stays usable.
- Edge runtime unreachable or non-404 upstream failure: `503` with
  `api.device.hardware_tools.unavailable`.
- Malformed upstream payload: `500` with
  `api.device.hardware_tools.invalid_response`.
- Unknown device or wrong tenant: `404` (`NotFound` problem).

## Invocation API Contract

- Method/path: `POST /backend/v3/api/iot/devices/{deviceId}/hardware_tool_calls/execute`
- Operation id: `devices.hardwareTools.execute`
- Permission: `iot.commands.execute`
- Body: `{toolName, arguments?}`; `arguments` must be a JSON object.
- Envelope: `{code:0,data:{item:{deviceId,toolName,result}},traceId}`
- `result` is the raw MCP JSON-RPC result (for example
  `{"content":[{"type":"text","text":"volume accepted"}]}`).

Behavior:

- The edge runtime checks the tool against the session catalog before sending
  `tools/call`; unknown tools return `404` (`NotFound`).
- One invocation per device is allowed at a time; a concurrent call returns
  `429` so an unresponsive device cannot accumulate pending work.
- Device JSON-RPC errors and timeouts return `503` with
  `api.device.hardware_tools.device_error` / `...timeout`.
- Invalid argument shapes return `422` with numeric `ValidationError`.
- Tool calls are synchronous and bounded by
  `SDKWORK_AIOT_HARDWARE_TOOL_CALL_TIMEOUT_MS` (default 12s); treat retries as
  explicit operator actions because device tools may not be idempotent.

## Configuration

| Env | Default | Purpose |
| --- | --- | --- |
| `SDKWORK_AIOT_EDGE_DEVICE_INGRESS_HTTP_URL` | `http://127.0.0.1:18080` | Edge runtime base URL |
| `SDKWORK_AIOT_INTERNAL_TOKEN` | unset | Sent as `x-sdkwork-internal-token`; required outside dev mode |
| `SDKWORK_AIOT_HARDWARE_TOOLS_TIMEOUT_MS` | `1500` | Catalog query timeout |
| `SDKWORK_AIOT_HARDWARE_TOOL_CALL_TIMEOUT_MS` | `12000` | Tool invocation timeout (must exceed the edge timeout) |

## Verification

```bash
cargo test -p sdkwork-iot-platform-service --test http_api_standard hardware_tool
cargo test -p sdkwork-aiot-device-edge-runtime xiaozhi_mcp
node ../sdkwork-specs/tools/check-api-operation-patterns.mjs --workspace .
node ../sdkwork-specs/tools/check-api-response-envelope.mjs --workspace .
pnpm --dir apps/sdkwork-aiot-pc exec vitest run packages/sdkwork-aiot-pc-console-admin
```

## Boundaries

- The catalog reflects the last `tools/list` exchange; it is not persisted
  across sessions.
- MQTT+UDP devices do not yet support server-initiated `tools/call`; the
  invocation surface currently targets WebSocket sessions.
- Realtime AEC streaming remains outside this surface; see the Xiaozhi protocol
  parity matrix.
