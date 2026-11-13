export interface AiotDeviceCreateRequest {
  deviceId: string;
  displayName: string;
  /** int64-as-string product identifier. */
  productId: string;
  clientId?: string;
  chipFamily?: string;
}
