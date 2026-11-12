import type { AiotDeviceSettingsBulkItemResult } from './aiot-device-settings-bulk-item-result';

export interface DeviceSettingsBulkUpdateResponse {
  code: 0;
  data: unknown & { items: AiotDeviceSettingsBulkItemResult[]; allOrNothing: boolean; };
  /** Server-owned request correlation id. */
  traceId: string;
}
