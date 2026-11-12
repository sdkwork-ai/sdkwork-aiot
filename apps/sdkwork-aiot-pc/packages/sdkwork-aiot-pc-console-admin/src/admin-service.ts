import {
  getAiotBackendSdkClient,
  type AiotDeviceSettingMap,
  type JsonValue,
  type SdkworkAiotBackendClient,
} from "@sdkwork/aiot-pc-core";

import {
  mapAdminDeviceRecord,
  mapAdminDeviceSettings,
  mapBulkResult,
  mapHardwareTools,
  mapSettingsHistoryPage,
  type SdkworkAdminBulkResult,
  type SdkworkAdminDevice,
  type SdkworkAdminDevicePage,
  type SdkworkAdminDeviceSettings,
  type SdkworkAdminDeviceSettingsDraft,
  type SdkworkAdminHardwareTools,
  type SdkworkAdminSettingsHistoryPage,
} from "./admin";

export const DEFAULT_ADMIN_DEVICE_PAGE_SIZE = 50;

export interface GetSdkworkAdminDevicesInput {
  page?: number;
  pageSize?: number;
}

export interface GetSdkworkAdminSettingsHistoryInput {
  page?: number;
  pageSize?: number;
}

export interface SdkworkAdminRollbackInput {
  expectedRevision?: string;
  targetRevision: string;
}

export interface SdkworkAdminBulkItemInput {
  deviceId: string;
  expectedRevision?: string;
  overrides: Record<string, unknown>;
}

export interface SdkworkAdminBulkApplyInput {
  allOrNothing?: boolean;
  items: SdkworkAdminBulkItemInput[];
}

export interface SdkworkAdminService {
  bulkApplySettings(input: SdkworkAdminBulkApplyInput): Promise<SdkworkAdminBulkResult>;
  getDeviceSettings(deviceId: string): Promise<SdkworkAdminDeviceSettings>;
  listDevices(input?: GetSdkworkAdminDevicesInput): Promise<SdkworkAdminDevicePage>;
  listHardwareTools(deviceId: string): Promise<SdkworkAdminHardwareTools>;
  listSettingsHistory(
    deviceId: string,
    input?: GetSdkworkAdminSettingsHistoryInput,
  ): Promise<SdkworkAdminSettingsHistoryPage>;
  resetDeviceSettings(deviceId: string): Promise<void>;
  rollbackDeviceSettings(
    deviceId: string,
    input: SdkworkAdminRollbackInput,
  ): Promise<SdkworkAdminDeviceSettings>;
  saveDeviceSettings(
    deviceId: string,
    draft: SdkworkAdminDeviceSettingsDraft,
    expectedRevision: string,
  ): Promise<SdkworkAdminDeviceSettings>;
}

export interface CreateSdkworkAdminServiceOptions {
  backendClient?: SdkworkAiotBackendClient;
}

const SETTINGS_REVISION_CONFLICT = 40901;

interface BackendProblemShape {
  code?: number | string;
  traceId?: string;
}

function readProblem(value: unknown): BackendProblemShape {
  return value && typeof value === "object" ? (value as BackendProblemShape) : {};
}

/**
 * True when the backend rejected a settings write because another operator
 * saved first, so the UI can reload and ask the operator to re-apply.
 */
export function isSettingsRevisionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    code?: unknown;
    httpStatus?: unknown;
    problem?: BackendProblemShape;
  };
  const problemCode = readProblem(candidate.problem).code;
  return (
    problemCode === SETTINGS_REVISION_CONFLICT
    || candidate.httpStatus === 409
    || candidate.code === "CONFLICT"
  );
}

export function describeAdminServiceError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "The IoT admin request failed.";
}

/**
 * Converts an operator draft value into a wire-safe JSON value. The JSON
 * round-trip is the guard: values that cannot be encoded are dropped instead of
 * reaching the typed SDK request.
 */
function toJsonValue(value: unknown): JsonValue | undefined {
  if (
    value === undefined
    || typeof value === "function"
    || typeof value === "symbol"
    || (typeof value === "number" && !Number.isFinite(value))
  ) {
    return undefined;
  }
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? undefined : (JSON.parse(encoded) as JsonValue);
  } catch {
    return undefined;
  }
}

function toJsonSettingMap(overrides: Readonly<Record<string, unknown>>): AiotDeviceSettingMap {
  const map: Record<string, JsonValue> = {};
  for (const [settingKey, value] of Object.entries(overrides)) {
    const jsonValue = toJsonValue(value);
    if (jsonValue !== undefined) {
      map[settingKey] = jsonValue;
    }
  }
  return map;
}

function mapDevicePage(value: unknown): SdkworkAdminDevicePage {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const items = Array.isArray(record.items)
    ? record.items.flatMap((item): SdkworkAdminDevice[] => {
        const device = mapAdminDeviceRecord(item);
        return device ? [device] : [];
      })
    : [];
  const pageInfo =
    record.pageInfo && typeof record.pageInfo === "object"
      ? (record.pageInfo as Record<string, unknown>)
      : {};
  const page = typeof pageInfo.page === "number" ? pageInfo.page : 1;
  const pageSize =
    typeof pageInfo.pageSize === "number" ? pageInfo.pageSize : DEFAULT_ADMIN_DEVICE_PAGE_SIZE;
  return {
    hasMore: pageInfo.hasMore === true,
    items,
    page,
    pageSize,
    ...(typeof pageInfo.total === "number" ? { total: pageInfo.total } : {}),
  };
}

export function createSdkworkAdminService(
  options: CreateSdkworkAdminServiceOptions = {},
): SdkworkAdminService {
  const resolveClient = (): SdkworkAiotBackendClient =>
    options.backendClient ?? getAiotBackendSdkClient();

  return {
    async getDeviceSettings(deviceId) {
      const response = await resolveClient().iot.devices.settings.retrieve(deviceId);
      return mapAdminDeviceSettings(response, deviceId);
    },

    async listDevices(input = {}) {
      const response = await resolveClient().iot.devices.list({
        page: input.page ?? 1,
        pageSize: input.pageSize ?? DEFAULT_ADMIN_DEVICE_PAGE_SIZE,
      });
      return mapDevicePage(response);
    },

    async listHardwareTools(deviceId) {
      const response = await resolveClient().iot.devices.hardwareTools.list(deviceId);
      return mapHardwareTools(response, deviceId);
    },

    async resetDeviceSettings(deviceId) {
      await resolveClient().iot.devices.settings.delete(deviceId);
    },

    async listSettingsHistory(deviceId, input = {}) {
      const response = await resolveClient().iot.devices.settings.history.list(deviceId, {
        page: input.page ?? 1,
        pageSize: input.pageSize ?? 20,
      });
      return mapSettingsHistoryPage(response);
    },

    async rollbackDeviceSettings(deviceId, input) {
      const response = await resolveClient().iot.devices.settings.rollback(deviceId, {
        targetRevision: input.targetRevision,
        ...(input.expectedRevision === undefined
          ? {}
          : { expectedRevision: input.expectedRevision }),
      });
      return mapAdminDeviceSettings(response, deviceId);
    },

    async bulkApplySettings(input) {
      const response = await resolveClient().iot.deviceSettings.bulkUpdate({
        allOrNothing: input.allOrNothing ?? false,
        items: input.items.map((item) => ({
          deviceId: item.deviceId,
          overrides: toJsonSettingMap(item.overrides),
          ...(item.expectedRevision === undefined
            ? {}
            : { expectedRevision: item.expectedRevision }),
        })),
      });
      return mapBulkResult(response);
    },

    async saveDeviceSettings(deviceId, draft, expectedRevision) {
      const response = await resolveClient().iot.devices.settings.update(deviceId, {
        expectedRevision,
        overrides: toJsonSettingMap(draft.overrides),
      });
      return mapAdminDeviceSettings(response, deviceId);
    },
  };
}

export const sdkworkAdminService = createSdkworkAdminService();
