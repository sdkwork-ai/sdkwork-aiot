export interface AiotDeviceSettingsRollbackRequest {
  /** Recorded revision whose overrides should be restored. */
  targetRevision: string;
  expectedRevision?: string;
}
