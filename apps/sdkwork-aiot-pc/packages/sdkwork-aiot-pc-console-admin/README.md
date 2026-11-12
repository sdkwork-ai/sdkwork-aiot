# @sdkwork/aiot-pc-console-admin

SDKWork AIoT device administration console surface for the PC client.

## Responsibility

- Render the tenant device inventory used by operators.
- Show the capability-model settings schema inherited by one device, its
  inherited defaults, its device-scoped overrides, and the effective values.
- Edit overrides through a schema-driven form and persist them with optimistic
  concurrency (`revision`), so a second operator cannot silently overwrite the
  first one's change.
- Reset a device back to inherited defaults.

## Boundaries

- UI -> service -> injected SDK client (`@sdkwork/aiot-pc-core`). Components
  never construct SDK clients or assemble HTTP/auth headers.
- Wire payloads are mapped in `src/admin-service.ts`; React components only see
  the domain types declared in `src/admin.ts`.
- Validation mirrors the backend schema rules for immediate feedback, but the
  backend remains authoritative.

## Verification

```bash
pnpm --filter @sdkwork/aiot-pc-console-admin typecheck
pnpm --filter @sdkwork/aiot-pc-console-admin test
```
