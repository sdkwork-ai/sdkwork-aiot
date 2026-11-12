import type { AiotDeviceSettingDefinition } from './aiot-device-setting-definition';
import type { CapabilityDefinition } from './capability-definition';

export interface AiotCapabilityModelUpdateRequest {
  displayName?: string;
  version?: string;
  capabilities?: CapabilityDefinition[];
  status?: string;
  /** Per-device settings schema inherited by every device of this capability model. */
  settings?: AiotDeviceSettingDefinition[];
}
