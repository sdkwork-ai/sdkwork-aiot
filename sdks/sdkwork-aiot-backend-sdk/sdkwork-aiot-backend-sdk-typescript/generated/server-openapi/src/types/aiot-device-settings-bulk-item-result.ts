import type { FieldError } from './field-error';

export interface AiotDeviceSettingsBulkItemResult {
  deviceId: string;
  /** updated = written and published; skipped = valid but not written because allOrNothing failed; invalid = schema/type violation; conflict = expectedRevision mismatch; failed = storage failure. */
  status: 'updated' | 'skipped' | 'invalid' | 'not_found' | 'conflict' | 'failed';
  revision?: string;
  errors?: FieldError[];
}
