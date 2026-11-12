import type { AiotDevice } from './aiot-device';

export interface DevicesUpdateResponse {
  code: 0;
  data: unknown & { item: AiotDevice; };
  /** Server-owned request correlation id. */
  traceId: string;
}
