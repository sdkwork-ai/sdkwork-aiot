/**
 * Smart Hardware console service (AIoT PC console).
 *
 * Every operation runs on the AIoT **app** API surface with the signed-in user's
 * session:
 *
 * | capability                     | operation                              |
 * | ------------------------------ | -------------------------------------- |
 * | my devices                     | `GET  /app/v3/api/iot/devices`         |
 * | device detail                  | `GET  /app/v3/api/iot/devices/{id}`    |
 * | register a device              | `POST /app/v3/api/iot/devices`         |
 * | persist the agent binding      | `PUT  /app/v3/api/iot/devices/{id}`    |
 * | product catalog for the form   | `GET  /app/v3/api/iot/products`        |
 * | firmware downloads             | `GET  /app/v3/api/iot/firmware_artifacts` |
 *
 * The service is declared as a port so an embedding host (for example the Cloud
 * Router user console) can inject its own session-bound client factory instead of
 * the AIoT application shell's.
 */

import type { SdkworkAiotAppClient } from '@sdkwork/aiot-app-sdk';

import {
  describeConsoleHardwareError,
  type ConsoleHardwareError,
  type ConsoleHardwareErrorKey,
} from './errors.ts';
import {
  mapAgent,
  mapDevice,
  mapPage,
  mapProduct,
  mapFirmware,
  withAgentBinding,
  type ConsoleHardwareAgent,
  type ConsoleHardwareDevice,
  type ConsoleHardwareFirmware,
  type ConsoleHardwarePage,
  type ConsoleHardwareProduct,
} from './hardware.ts';

export const CONSOLE_HARDWARE_PAGE_SIZE = 20;

export { describeConsoleHardwareError, type ConsoleHardwareError, type ConsoleHardwareErrorKey };

export interface ConsoleHardwareListInput {
  page?: number;
  pageSize?: number;
}

export interface ConsoleRegisterDeviceInput {
  chipFamily?: string;
  clientId?: string;
  deviceId: string;
  displayName: string;
  productId: string;
}

export interface ConsoleHardwareService {
  bindDeviceAgent(
    device: ConsoleHardwareDevice,
    agent: Pick<ConsoleHardwareAgent, 'agentId' | 'name'> | null,
  ): Promise<ConsoleHardwareDevice | null>;
  listAgents(input?: ConsoleHardwareListInput): Promise<ConsoleHardwarePage<ConsoleHardwareAgent>>;
  listDevices(input?: ConsoleHardwareListInput): Promise<ConsoleHardwarePage<ConsoleHardwareDevice>>;
  listFirmware(input?: ConsoleHardwareListInput): Promise<ConsoleHardwarePage<ConsoleHardwareFirmware>>;
  listProducts(input?: ConsoleHardwareListInput): Promise<ConsoleHardwarePage<ConsoleHardwareProduct>>;
  registerDevice(input: ConsoleRegisterDeviceInput): Promise<ConsoleHardwareDevice | null>;
  /** Renames a device the signed-in user owns. */
  renameDevice(device: ConsoleHardwareDevice, displayName: string): Promise<ConsoleHardwareDevice | null>;
  retrieveDevice(deviceId: string): Promise<ConsoleHardwareDevice | null>;
}

function pageInput(input: ConsoleHardwareListInput | undefined): { page: number; pageSize: number } {
  return {
    page: input?.page ?? 1,
    pageSize: input?.pageSize ?? CONSOLE_HARDWARE_PAGE_SIZE,
  };
}

function createOperationIdempotencyKey(prefix: string): { idempotencyKey: string } {
  const randomPart =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { idempotencyKey: `${prefix}-${randomPart}` };
}

export interface CreateConsoleHardwareServiceOptions {
  /**
   * Client resolution seam. Required on purpose: the port must not reach for the
   * AIoT application runtime, so the app shell (and any embedding host) supplies
   * the session-bound client explicitly.
   */
  resolveClient: () => SdkworkAiotAppClient;
  /** Agent catalog seam: the console shows the user's agents. */
  resolveAgents?: () => Promise<ConsoleHardwarePage<ConsoleHardwareAgent>>;
}

export function createConsoleHardwareService(
  options: CreateConsoleHardwareServiceOptions,
): ConsoleHardwareService {
  const resolveClient = options.resolveClient;

  return {
    async listDevices(input) {
      const response = await resolveClient().iot.devices.list(pageInput(input));
      return mapPage(response, mapDevice);
    },

    async retrieveDevice(deviceId) {
      const response = await resolveClient().iot.devices.retrieve(deviceId);
      return mapDevice(response);
    },

    async registerDevice(input) {
      const response = await resolveClient().iot.devices.create(
        {
          deviceId: input.deviceId,
          displayName: input.displayName,
          productId: input.productId,
          ...(input.clientId ? { clientId: input.clientId } : {}),
          ...(input.chipFamily ? { chipFamily: input.chipFamily } : {}),
        },
        createOperationIdempotencyKey('iot-console-device-create'),
      );
      return mapDevice(response);
    },

    async bindDeviceAgent(device, agent) {
      const response = await resolveClient().iot.devices.update(
        device.deviceId,
        { metadata: withAgentBinding(device.metadata, agent) as never },
        createOperationIdempotencyKey('iot-console-device-bind'),
      );
      return mapDevice(response);
    },

    async renameDevice(device, displayName) {
      const trimmed = displayName.trim();
      if (!trimmed) {
        throw new Error('Device display name must not be empty');
      }
      const response = await resolveClient().iot.devices.update(
        device.deviceId,
        { displayName: trimmed },
        createOperationIdempotencyKey('iot-console-device-rename'),
      );
      return mapDevice(response);
    },

    async listProducts(input) {
      const response = await resolveClient().iot.products.list(pageInput(input));
      return mapPage(response, mapProduct);
    },

    async listFirmware(input) {
      const response = await resolveClient().iot.firmwareArtifacts.list(pageInput(input));
      return mapPage(response, mapFirmware);
    },

    async listAgents(input) {
      if (options.resolveAgents) {
        return options.resolveAgents();
      }
      return { hasMore: false, items: [], page: 1, pageSize: pageInput(input).pageSize };
    },
  };
}
