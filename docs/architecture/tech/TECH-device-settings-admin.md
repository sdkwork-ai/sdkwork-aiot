# TECH - Per-Device Settings Administration

Status: implemented (1.1.0 API surface)

## Problem

A terminal device is not configured by the platform only once, at manufacture
time. Operators need to tune behaviour for one physical device without cloning a
product: wake word, language, volume, brightness, sleep timers, heartbeat, or
gateway-local policy. A commercial IoT control plane must make that
customisation explicit, typed, validated, inheritable, and auditable.

Before this change the only device-scoped configuration surface was the free-form
`metadata` JSON on `AiotDeviceUpdateRequest`, plus the generic twin `desired`
map. That is untyped: the control plane cannot tell a valid value from a typo, it
cannot show inherited defaults, and no revision guard prevents two operators from
overwriting each other.

## Model

```
capability model (per product family)
  settings: DeviceSettingDefinition[]
        |
        | inherits (by product.defaultCapabilityModelId)
        v
device settings defaults  (definition.defaultValue)
        |
        | device-scoped overrides (validated against the same definitions)
        v
effective device settings  ->  twin desired property `settings`
```

- The settings **schema belongs to the capability model**, i.e. to the product
  family ("thing model"), and is authored through
  `POST|PUT /backend/v3/api/iot/capability_models`.
- A device **inherits defaults** and may store **overrides**; it never mutates the
  model.
- The **effective** configuration is `defaults + overrides` and is the only value
  published to the device twin.
- Each device settings record has a monotonic `revision`; writes may carry
  `expectedRevision` and fail with HTTP 409 when another operator saved first.
- Deleting settings clears overrides so the inherited defaults apply again.

### Value domain

`AiotDeviceSettingKind` is `boolean | integer | number | string | enum | json`.

Every definition may declare `required`, `writable`, `sensitive`, `group`,
`unit`, `defaultValue`, `minimum`, `maximum`, `maxLength`, and enum `options`.
Schema validation rejects duplicate keys, malformed keys, enums without options,
inverted ranges, range constraints on non-numeric kinds, and defaults that
violate their own domain.

## API contract

| Operation | Method and path | Permission |
| --- | --- | --- |
| `devices.settings.retrieve` | `GET /backend/v3/api/iot/devices/{deviceId}/settings` | `iot.deviceSettings.read` |
| `devices.settings.update` | `PUT /backend/v3/api/iot/devices/{deviceId}/settings` | `iot.deviceSettings.write` |
| `devices.settings.delete` | `DELETE /backend/v3/api/iot/devices/{deviceId}/settings` | `iot.deviceSettings.write` |
| `devices.settings.history.list` | `GET /backend/v3/api/iot/devices/{deviceId}/settings/history` | `iot.deviceSettings.read` |
| `devices.settings.rollback` | `POST /backend/v3/api/iot/devices/{deviceId}/settings/rollback` | `iot.deviceSettings.write` |
| `deviceSettings.bulkUpdate` | `POST /backend/v3/api/iot/device_settings/bulk_update` | `iot.deviceSettings.write` |

The rollback action uses a slash action segment and bulk update uses a dedicated
collection command path because the canonical TypeScript generator currently
rejects `:<action>` path segments (`API_SPEC.md` §5.1 allows them; the generator
validator does not yet). Operation ids still follow the command/bulk naming
patterns, so the contracts remain SDK-generatable until the generator catches up.

The retrieve and update responses return `AiotDeviceSettings` under `data.item`:
`deviceId`, `productId`, `capabilityModelId`, `revision` (int64 string),
`definitions`, `defaults`, `overrides`, `effective`, `updatedAt`, `updatedBy`.

The update body is `AiotDeviceSettingsUpdateRequest`:

```json
{
  "expectedRevision": "3",
  "overrides": {
    "audio.volume": 35,
    "assistant.wakeWord": "小智小智",
    "display.brightness": null
  }
}
```

`overrides` replaces the whole device override set; a `null` value clears one
setting so the inherited default applies again.

### Status codes

| Condition | Status | `code` |
| --- | --- | --- |
| Invalid request body shape | 400 | `40001` / `40004` |
| Setting value, unknown key, or read-only key | 422 | `40001` with `errors[]` |
| Stored overrides no longer match the schema | 409 | `40901` with `errors[]` |
| `expectedRevision` mismatch | 409 | `40901` with `errors[]` |
| Device not found or out of tenant/organization scope | 404 | `40401` |
| Missing permission | 403 | `40301` |

## Persistence

Overrides are stored in the admin entity store (`iot_admin_entity`, entity kind
`device_settings`, key = device id). The record payload is
`{deviceId, revision, overrides, updatedAt, updatedBy}` so no new table or
migration is required, and the same store works for PostgreSQL and the SQLite
test profile. Records are tenant- and organization-scoped through the existing
`AiotStorageAssociation` key.

Writes are serialized inside one process: the revision check and the write form
one critical section, so concurrent operators served by the same gateway cannot
both pass the guard. Deployments that expose the admin API from several replicas
should add a row-version compare-and-set in the entity store; until then the
revision guard is authoritative per process.

Deleting a device also deletes its settings record, so a device recreated with
the same id starts from the inherited defaults instead of stale overrides.

## Audit, rollback, and bulk apply

Every successful write appends an immutable revision to the history store
(`iot_admin_entity`, kind `device_settings_history`, key `<deviceId>:<revision>`).
An entry records the revision, the action (`update`, `reset`, or `rollback`), the
override snapshot, the changed setting keys, the timestamp, and the operator.

- `settings/rollback` restores the snapshot of a recorded revision as a new
  revision. The snapshot is revalidated against the current capability model
  schema before it is applied, so a schema change cannot silently reintroduce an
  invalid value; a missing revision fails with `404`.
- `device_settings/bulk_update` applies one override set per device and returns
  item-level results (`updated`, `skipped`, `invalid`, `not_found`, `conflict`,
  `failed`). `allOrNothing: true` validates every item first and writes nothing
  when any item is invalid, marking the valid items `skipped`. A request is
  limited to 100 items and duplicate device ids are rejected.

History writes are best-effort: a history persistence failure never converts a
successful settings write into an operator-facing error.

## Distribution

After a successful write the effective settings are published to the device twin
(`desired.settings`) together with `desired.settingsRevision`, so the existing
twin delivery path is the single distribution channel. A twin write failure is
reported as `500` instead of silently claiming the device received the change.

## Operator surface

`@sdkwork/aiot-pc-console-admin` renders the device administration console:
inventory search and health filters, per-device settings groups, inherited vs
overridden badges, inline validation, save with revision, conflict recovery,
"reset to inherited defaults", the revision history with per-revision rollback,
multi-device selection, and bulk application of the current draft with per-device
results. It consumes the generated backend SDK through `@sdkwork/aiot-pc-core`;
no component builds raw HTTP or auth headers.

## Verification

```bash
node ../sdkwork-specs/tools/check-api-operation-patterns.mjs --workspace .
node ../sdkwork-specs/tools/check-api-response-envelope.mjs --workspace .
cargo test -p sdkwork-iot-device-service
cargo test -p sdkwork-iot-platform-service
pnpm --filter @sdkwork/aiot-pc-console-admin typecheck
pnpm --filter @sdkwork/aiot-pc-console-admin test
```

The platform test suite covers: inherited defaults, override persistence and twin
publication, schema/value rejection with `errors[]`, optimistic concurrency
conflict, reset to defaults, permission and tenant isolation, capability model
schema validation, persistence across an admin API server restart, revision
history ordering and rollback, and bulk update item-level semantics
(`updated`/`invalid`/`skipped`) with all-or-nothing behavior.
