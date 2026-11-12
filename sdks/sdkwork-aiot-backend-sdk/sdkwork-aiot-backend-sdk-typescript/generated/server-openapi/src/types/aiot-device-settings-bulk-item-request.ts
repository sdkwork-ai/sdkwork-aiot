import type { AiotDeviceSettingMap } from './aiot-device-setting-map';

export interface AiotDeviceSettingsBulkItemRequest {
  deviceId: string;
  expectedRevision?: string;
  overrides: AiotDeviceSettingMap;
}
