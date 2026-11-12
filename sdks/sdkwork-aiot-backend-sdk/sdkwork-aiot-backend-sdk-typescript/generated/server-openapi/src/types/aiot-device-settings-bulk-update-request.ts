import type { AiotDeviceSettingsBulkItemRequest } from './aiot-device-settings-bulk-item-request';

export interface AiotDeviceSettingsBulkUpdateRequest {
  allOrNothing?: boolean;
  items: AiotDeviceSettingsBulkItemRequest[];
}
