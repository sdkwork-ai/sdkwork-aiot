import type { AiotDevice } from './aiot-device';

export interface DevicesCreateResponse201 {
  code: 0;
  data: unknown & { item: AiotDevice; };
  /** Server-owned request correlation id. */
  traceId: string;
}
