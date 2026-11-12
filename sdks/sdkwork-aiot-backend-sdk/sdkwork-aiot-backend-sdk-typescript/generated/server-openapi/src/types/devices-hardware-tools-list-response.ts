import type { AiotDeviceHardwareTools } from './aiot-device-hardware-tools';

export interface DevicesHardwareToolsListResponse {
  code: 0;
  data: unknown & { item: AiotDeviceHardwareTools; };
  /** Server-owned request correlation id. */
  traceId: string;
}
