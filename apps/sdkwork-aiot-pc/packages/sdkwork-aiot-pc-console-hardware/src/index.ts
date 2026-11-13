/**
 * Smart Hardware console public surface (SDKWork AIoT user console).
 *
 * The view is host-agnostic: it renders from a `ConsoleHardwareService` port and a
 * copy override, so both the AIoT application shell and an embedding host (the
 * Cloud Router user console) compose it without sharing transport code. The
 * default service binding lives in `./service` so a host that injects its own
 * client never pulls the AIoT PC runtime.
 */
export { SdkworkHardwareConsole, type SdkworkHardwareConsoleProps, type ConsoleHardwareScreen } from './hardware-console.tsx';
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
