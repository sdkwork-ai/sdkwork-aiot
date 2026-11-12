import type { AiotDeviceSettingMap } from './aiot-device-setting-map';
import type { AiotDeviceSettingsChangeAction } from './aiot-device-settings-change-action';

export interface AiotDeviceSettingsHistoryEntry {
  revision: string;
  action: AiotDeviceSettingsChangeAction;
  changedKeys: string[];
  overrides: AiotDeviceSettingMap;
  updatedAt: string;
  updatedBy?: string;
}
