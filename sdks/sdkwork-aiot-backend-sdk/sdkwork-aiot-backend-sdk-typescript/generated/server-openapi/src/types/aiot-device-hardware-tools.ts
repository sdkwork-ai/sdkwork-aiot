import type { AiotDeviceHardwareTool } from './aiot-device-hardware-tool';

export interface AiotDeviceHardwareTools {
  deviceId: string;
  online: boolean;
  discovered: boolean;
  tools: AiotDeviceHardwareTool[];
}
