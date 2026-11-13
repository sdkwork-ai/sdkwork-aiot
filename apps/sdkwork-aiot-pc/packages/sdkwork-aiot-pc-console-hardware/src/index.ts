/**
 * Smart Hardware console public surface (SDKWork AIoT user console).
 *
 * Two independent pages, one per URL:
 *
 * - `SdkworkHardwareDevicesPage`   -> `/console/hardware` (my devices, binding)
 * - `SdkworkHardwareFirmwarePage`  -> `/console/hardware/firmware` (downloads)
 *
 * Both pages render from a `ConsoleHardwareService` port and a copy override, so
 * an embedding host composes them without sharing transport code. The default
 * service binding lives in `./service-default` and is imported lazily: a host that
 * injects its own client never pulls the AIoT PC runtime.
 */
export {
  SdkworkHardwareDevicesPage,
  type SdkworkHardwareDevicesPageProps,
} from './devices-page.tsx';
export {
  SdkworkHardwareFirmwarePage,
  type SdkworkHardwareFirmwarePageProps,
} from './firmware-page.tsx';
export {
  HEALTH_TONE,
  HardwarePageShell,
  Panel,
  PrimaryButton,
  RegisterDrawer,
  SecondaryButton,
  StatTile,
  type ConsoleHardwareScreen,
  type HardwarePageErrorState,
  type HardwarePageShellProps,
  type RegisterDrawerProps,
} from './hardware-console-chrome.tsx';
export {
  HARDWARE_CONSOLE_COPY_EN,
  formatHardwareConsoleCopy,
  resolveHardwareConsoleCopy,
  type HardwareConsoleCopy,
} from './copy.ts';
export {
  countHealth,
  DEVICE_AGENT_ID_KEY,
  DEVICE_AGENT_NAME_KEY,
  firmwareDownloadUrl,
  formatTimestamp,
  mapAgent,
  mapDevice,
  mapEvent,
  mapFirmware,
  mapPage,
  mapProduct,
  mapTwin,
  matchesQuery,
  normalizeHealth,
  withAgentBinding,
  type ConsoleHardwareAgent,
  type ConsoleHardwareDevice,
  type ConsoleHardwareEvent,
  type ConsoleHardwareFirmware,
  type ConsoleHardwarePage,
  type ConsoleHardwareProduct,
  type ConsoleHardwareTwin,
} from './hardware.ts';
export {
  CONSOLE_HARDWARE_PAGE_SIZE,
  createConsoleHardwareService,
  describeConsoleHardwareError,
  type ConsoleHardwareError,
  type ConsoleHardwareErrorKey,
  type ConsoleHardwareListInput,
  type ConsoleHardwareService,
  type ConsoleRegisterDeviceInput,
  type CreateConsoleHardwareServiceOptions,
} from './hardware-service.ts';
