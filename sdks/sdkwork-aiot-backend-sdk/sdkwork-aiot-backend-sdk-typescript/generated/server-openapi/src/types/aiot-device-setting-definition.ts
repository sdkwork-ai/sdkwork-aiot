import type { AiotDeviceSettingKind } from './aiot-device-setting-kind';
import type { AiotDeviceSettingOption } from './aiot-device-setting-option';
import type { JsonValue } from './json-value';

export interface AiotDeviceSettingDefinition {
  /** Stable dotted setting key, for example audio.volume. */
  settingKey: string;
  displayName: string;
  description?: string;
  kind: AiotDeviceSettingKind;
  required?: boolean;
  writable?: boolean;
  sensitive?: boolean;
  group?: string;
  unit?: string;
  defaultValue?: JsonValue;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  options?: AiotDeviceSettingOption[];
}
