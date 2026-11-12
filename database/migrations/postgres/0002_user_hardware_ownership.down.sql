-- sdkwork:migration
-- id: 0002_user_hardware_ownership
-- engine: postgres
-- module: sdkwork-aiot
-- purpose: Reverse the user-hardware ownership index introduced by the matching
--   up migration. Index-only change; no rows are touched.
-- reversible: true
-- rollback: forward-fix (re-apply the up migration when the index is needed again)
-- transactional: true
-- lock: lightweight
-- lock_timeout: 2s
-- statement_timeout: 30s

BEGIN;

DROP INDEX IF EXISTS idx_iot_device_tenant_owner;

COMMIT;
