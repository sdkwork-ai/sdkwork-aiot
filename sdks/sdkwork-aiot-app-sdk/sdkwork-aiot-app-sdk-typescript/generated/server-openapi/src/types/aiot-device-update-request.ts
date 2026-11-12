import type { JsonValue } from './json-value';

export interface AiotDeviceUpdateRequest {
  displayName?: string;
  status?: string;
  metadata?: JsonValue;
}
