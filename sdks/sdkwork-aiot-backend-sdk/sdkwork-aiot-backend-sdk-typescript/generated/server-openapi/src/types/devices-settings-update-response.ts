import type { AiotDeviceSettings } from './aiot-device-settings';

export interface DevicesSettingsUpdateResponse {
  code: 0;
  data: unknown & { item: AiotDeviceSettings; };
  /** Server-owned request correlation id. */
  traceId: string;
}
