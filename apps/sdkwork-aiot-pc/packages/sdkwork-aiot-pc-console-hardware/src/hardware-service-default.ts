/**
 * AIoT application binding of the Smart Hardware console port.
 *
 * This is the only module that touches the AIoT PC runtime clients, and it is
 * reached exclusively through the console view's lazy `import('./hardware-service-default.ts')`.
 * An embedding host that injects its own `ConsoleHardwareService` (for example the
 * Cloud Router user console) therefore never loads this application's runtime.
 */

import { getAiotAppSdkClient } from '@sdkwork/aiot-pc-core';

import {
  createConsoleHardwareService,
  type ConsoleHardwareService,
} from './hardware-service.ts';

let defaultService: ConsoleHardwareService | undefined;

/** Lazily binds the AIoT application's session-bound app client. */
export function getConsoleHardwareService(): ConsoleHardwareService {
  if (!defaultService) {
    defaultService = createConsoleHardwareService({
      resolveClient: () => getAiotAppSdkClient(),
    });
  }
  return defaultService;
}

export function resetConsoleHardwareServiceForTests(): void {
  defaultService = undefined;
}
