import type { AiotDeviceSettingMap } from './aiot-device-setting-map';

export interface AiotDeviceSettingsUpdateRequest {
  /** Revision returned by the last read; mismatch fails with HTTP 409. */
  expectedRevision?: string;
  /** Replacement override set. A null value clears that setting so the inherited default applies again. */
  overrides: AiotDeviceSettingMap;
}
