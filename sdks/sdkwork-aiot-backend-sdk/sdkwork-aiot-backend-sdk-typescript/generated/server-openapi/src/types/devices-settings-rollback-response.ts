import type { AiotDeviceSettings } from './aiot-device-settings';

export interface DevicesSettingsRollbackResponse {
  code: 0;
  data: unknown & { item: AiotDeviceSettings; };
  /** Server-owned request correlation id. */
  traceId: string;
}
