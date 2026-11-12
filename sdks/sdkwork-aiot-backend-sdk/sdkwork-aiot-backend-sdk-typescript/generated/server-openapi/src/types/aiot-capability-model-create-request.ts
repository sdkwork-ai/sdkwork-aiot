import type { AiotDeviceSettingDefinition } from './aiot-device-setting-definition';
import type { CapabilityDefinition } from './capability-definition';

export interface AiotCapabilityModelCreateRequest {
  capabilityModelId: string;
  displayName: string;
  version: string;
  capabilities?: CapabilityDefinition[];
  /** Per-device settings schema inherited by every device of this capability model. */
  settings?: AiotDeviceSettingDefinition[];
}
