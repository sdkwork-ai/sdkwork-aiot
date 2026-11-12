import type { ConsoleHardwareErrorKey } from './hardware-service.ts';

/**
 * Operator-facing copy of the Smart Hardware console.
 *
 * The AIoT application shell uses {@link HARDWARE_CONSOLE_COPY_EN}; an embedding
 * host (for example the Cloud Router user console) passes its own localized copy,
 * so the console keeps one presentation contract while every host keeps its own
 * language resources.
 */
export interface HardwareConsoleCopy {
  agentBound: string;
  agentDescription: string;
  agentEmpty: string;
  agentNone: string;
  agentReadOnly: string;
  agentSave: string;
  agentSaved: string;
  agentSelect: string;
  agentTitle: string;
  cancel: string;
  chipLabel: string;
  clientIdLabel: string;
  close: string;
  columnArtifact: string;
  columnChecksum: string;
  columnDownload: string;
  columnStatus: string;
  columnTarget: string;
  columnVersion: string;
  confirm: string;
  count: string;
  description: string;
  deviceIdColumn: string;
  deviceIdHint: string;
  deviceIdLabel: string;
  deviceTitle: string;
  displayNameLabel: string;
  download: string;
  emptyDevices: string;
  emptyDevicesHint: string;
  emptyFirmware: string;
  emptyFirmwareHint: string;
  errors: Record<ConsoleHardwareErrorKey, string>;
  firmwareDescription: string;
  firmwareHint: string;
  firmwareTitle: string;
  healthCritical: string;
  healthHealthy: string;
  healthOffline: string;
  healthWarning: string;
  identityTitle: string;
  lastSeen: string;
  loading: string;
  loadMore: string;
  managedOnly: string;
  noMatches: string;
  noProducts: string;
  openDevice: string;
  productColumn: string;
  productHint: string;
  productLabel: string;
  readOnlyHint: string;
  refresh: string;
  register: string;
  registerDescription: string;
  registerTitle: string;
  renameLabel: string;
  renameSave: string;
  renamed: string;
  required: string;
  retry: string;
  saving: string;
  searchDevices: string;
  searchFirmware: string;
  selectPlaceholder: string;
  statAttention: string;
  statBound: string;
  statOnline: string;
  statTotal: string;
  tabDevices: string;
  tabFirmware: string;
  title: string;
}

export const HARDWARE_CONSOLE_COPY_EN: HardwareConsoleCopy = {
  agentBound: 'Operated by {{name}}',
  agentDescription:
    'The agent that operates this device. Ask it to report state, run a routine, or explain an alert.',
  agentEmpty: 'No agent bound',
  agentNone: 'No agent',
  agentReadOnly: 'Your account can view the binding but cannot change it.',
  agentSave: 'Save binding',
  agentSaved: 'Agent binding saved.',
  agentSelect: 'Agent',
  agentTitle: 'Bound agent',
  cancel: 'Cancel',
  chipLabel: 'Chip family',
  clientIdLabel: 'Client ID',
  close: 'Close',
  columnArtifact: 'Artifact',
  columnChecksum: 'SHA-256',
  columnDownload: 'Download',
  columnStatus: 'Status',
  columnTarget: 'Target',
  columnVersion: 'Version',
  confirm: 'Confirm',
  count: '{{count}} item(s)',
  description: 'Your terminal devices, firmware downloads, and the agent bound to each device.',
  deviceIdColumn: 'Device ID',
  deviceIdHint: 'Hardware serial or provisioned identity; it cannot be renamed later.',
  deviceIdLabel: 'Device ID',
  deviceTitle: 'Device',
  displayNameLabel: 'Display name',
  download: 'Download',
  emptyDevices: 'No device registered yet.',
  emptyDevicesHint: 'Register your first terminal device to manage it from here.',
  emptyFirmware: 'No firmware published yet.',
  emptyFirmwareHint: 'Firmware appears here once an administrator publishes an artifact.',
  errors: {
    conflict: 'The request could not be completed.',
    forbidden: 'Your account is missing the IoT permission for this action.',
    notFound: 'This device is no longer available.',
    unauthorized: 'Your session has expired. Sign in again.',
    unavailable: 'The AIoT service is unavailable. Try again shortly.',
    validation: 'Please review the submitted values.',
  },
  firmwareDescription:
    'Published firmware for your device products, with the checksum and target chip family of every artifact.',
  firmwareHint: 'Verify the checksum before flashing. Artifacts without a direct link use the managed update channel.',
  firmwareTitle: 'Firmware downloads',
  healthCritical: 'Critical',
  healthHealthy: 'Online',
  healthOffline: 'Offline',
  healthWarning: 'Warning',
  identityTitle: 'Device identity',
  lastSeen: 'Last seen',
  loading: 'Loading your hardware...',
  loadMore: 'Load more',
  managedOnly: 'Managed delivery',
  noMatches: 'Nothing matches the current search.',
  noProducts: 'No product is available to register against.',
  openDevice: 'Open device',
  productColumn: 'Product',
  productHint: 'The product defines the capability model and settings schema.',
  productLabel: 'Product',
  readOnlyHint: 'Your account can view devices but cannot register them.',
  refresh: 'Refresh',
  register: 'Register device',
  registerDescription: 'The device identity is the hardware serial or the provisioned id on the device label.',
  registerTitle: 'Register a device',
  renameLabel: 'Device name',
  renameSave: 'Rename',
  renamed: 'Device renamed.',
  required: 'This field is required.',
  retry: 'Retry',
  saving: 'Saving...',
  searchDevices: 'Search device, product, chip, or agent',
  searchFirmware: 'Search artifact, version, or chip',
  selectPlaceholder: 'Select an option',
  statAttention: 'Need attention',
  statBound: 'Agent bound',
  statOnline: 'Online',
  statTotal: 'My devices',
  tabDevices: 'My hardware',
  tabFirmware: 'Firmware downloads',
  title: 'Smart Hardware',
};

/** Merges a host copy override over the English defaults. */
export function resolveHardwareConsoleCopy(
  overrides?: Partial<HardwareConsoleCopy>,
): HardwareConsoleCopy {
  if (!overrides) {
    return HARDWARE_CONSOLE_COPY_EN;
  }
  return {
    ...HARDWARE_CONSOLE_COPY_EN,
    ...overrides,
    errors: { ...HARDWARE_CONSOLE_COPY_EN.errors, ...(overrides.errors ?? {}) },
  };
}

/** Substitutes `{{name}}` style placeholders without pulling in i18next. */
export function formatHardwareConsoleCopy(
  template: string,
  variables: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/gu, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match,
  );
}
