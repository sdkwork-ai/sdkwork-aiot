import type { AiotDeviceSettingDefinition } from './aiot-device-setting-definition';
import type { AiotDeviceSettingMap } from './aiot-device-setting-map';

export interface AiotDeviceSettings {
  deviceId: string;
  productId: string;
  capabilityModelId: string;
  /** Monotonic overrides revision used for optimistic concurrency. */
  revision: string;
  definitions: AiotDeviceSettingDefinition[];
  defaults: AiotDeviceSettingMap;
  overrides: AiotDeviceSettingMap;
  effective: AiotDeviceSettingMap;
  updatedAt?: string;
  updatedBy?: string;
}
