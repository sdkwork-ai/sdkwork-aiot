-- sdkwork:migration
-- id: 0002_user_hardware_ownership
-- engine: postgres
-- module: sdkwork-aiot
-- purpose: Serve the user-console "smart hardware" group from the ownership
--   relation the device table already carries. A user's own terminal devices are
--   iot_device rows with owner_type = 'user' and owner_id = <iam user id>; the
--   console lists and retrieves them per signed-in user. Without a dedicated
--   composite index that lookup degrades into a tenant-wide scan.
-- reversible: true
-- rollback: down-migration drops idx_iot_device_tenant_owner; the statement is a
--   pure index addition, so dropping it restores the previous schema without
--   data loss.
-- transactional: true
-- lock: lightweight
-- lock_timeout: 2s
-- statement_timeout: 30s

BEGIN;

CREATE INDEX IF NOT EXISTS idx_iot_device_tenant_owner
    ON iot_device (tenant_id, owner_type, owner_id);

COMMIT;
