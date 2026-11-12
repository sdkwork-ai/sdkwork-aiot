# SDKWork AIoT PC

Console packages for device and IoT fleet management in the SDKWork AIoT PC application workspace.

## Topology

Client runtime reads v2 topology surface keys from `specs/topology.spec.json` via `@sdkwork/aiot-pc-core`:

- `VITE_SDKWORK_AIOT_APPLICATION_APP_HTTP_URL` — app API (`application.app-http`)
- `VITE_SDKWORK_AIOT_APPLICATION_ADMIN_HTTP_URL` — admin API (`application.admin-http`)
- `VITE_SDKWORK_AIOT_EDGE_DEVICE_INGRESS_HTTP_URL` — device edge ingress (`edge.device-ingress`)
- `VITE_SDKWORK_AIOT_PLATFORM_API_GATEWAY_HTTP_URL` — platform gateway for IAM/appbase SDKs

Start the backend stack from the repository root:

```bash
pnpm dev
```

Optional renderer overrides: copy `.env.example` into this directory when running a Vite shell locally.

## Test toolchain pin

`vite` is pinned to `8.0.3`. Vite/rolldown `8.1.x` rewrites the argument of a
generated SDK method literally named `import(...)`, which produces a parse error
in the `@sdkwork/agents-app-sdk` transport and fails every Vitest suite that
loads `@sdkwork/aiot-pc-core`. Move the pin forward only after
`pnpm --dir apps/sdkwork-aiot-pc exec vitest run` passes on the newer version.
