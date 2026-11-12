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

The catalog is read-only in this surface. Tool invocation is a separate command
path and is not exposed by this API.

## Data Flow

```
device WS session
  -> edge runtime: initialize + paged tools/list (MCP)
  -> edge runtime cache (per session)
  -> GET /internal/xiaozhi/mcp_tools?device_id=...
  -> platform service: GET /backend/v3/api/iot/devices/{deviceId}/hardware_tools
  -> generated backend SDK: client.iot.devices.hardwareTools.list(deviceId)
  -> PC admin: DeviceHardwareToolsPanel
```

The platform service never owns protocol session state. It validates the device
against the tenant-scoped repository, then queries the edge runtime with a
short timeout (default 1500 ms).

## API Contract

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

## Configuration

| Env | Default | Purpose |
| --- | --- | --- |
| `SDKWORK_AIOT_EDGE_DEVICE_INGRESS_HTTP_URL` | `http://127.0.0.1:18080` | Edge runtime base URL |
| `SDKWORK_AIOT_INTERNAL_TOKEN` | unset | Sent as `x-sdkwork-internal-token`; required outside dev mode |
| `SDKWORK_AIOT_HARDWARE_TOOLS_TIMEOUT_MS` | `1500` | Upstream query timeout |

## Verification

```bash
cargo test -p sdkwork-iot-platform-service --test http_api_standard hardware_tools
cargo test -p sdkwork-aiot-device-edge-runtime xiaozhi_mcp
node ../sdkwork-specs/tools/check-api-operation-patterns.mjs --workspace .
node ../sdkwork-specs/tools/check-api-response-envelope.mjs --workspace .
pnpm --dir apps/sdkwork-aiot-pc exec vitest run packages/sdkwork-aiot-pc-console-admin
```

## Boundaries

- The catalog reflects the last `tools/list` exchange; it is not persisted
  across sessions.
- Realtime AEC streaming and server-initiated `tools/call` remain outside this
  surface; see the Xiaozhi protocol parity matrix.
