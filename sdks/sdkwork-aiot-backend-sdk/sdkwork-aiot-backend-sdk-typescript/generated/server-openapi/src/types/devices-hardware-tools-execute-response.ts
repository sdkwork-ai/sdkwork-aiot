import type { AiotDeviceHardwareToolCallResult } from './aiot-device-hardware-tool-call-result';

export interface DevicesHardwareToolsExecuteResponse {
  code: 0;
  data: unknown & { item: AiotDeviceHardwareToolCallResult; };
  /** Server-owned request correlation id. */
  traceId: string;
}
