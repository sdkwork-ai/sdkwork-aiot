import { useMemo, useSyncExternalStore } from "react";

import {
  countOverrides,
  summarizeBulkResult,
  validateSettingsDraft,
  type SdkworkAdminBulkResult,
  type SdkworkAdminDevice,
  type SdkworkAdminDeviceHealth,
  type SdkworkAdminDeviceSettings,
  type SdkworkAdminHardwareTools,
  type SdkworkAdminSettingsHistoryEntry,
} from "./admin";
import {
  createSdkworkAdminService,
  describeAdminServiceError,
  isSettingsRevisionConflict,
  type GetSdkworkAdminDevicesInput,
  type SdkworkAdminService,
} from "./admin-service";

export interface SdkworkAdminControllerState {
  bulkResult?: SdkworkAdminBulkResult;
  bulkSelection: string[];
  devices: SdkworkAdminDevice[];
  draftErrors: Record<string, string>;
  draftOverrides: Record<string, unknown>;
  healthFilter: SdkworkAdminDeviceHealth | "all";
  hardwareTools: SdkworkAdminHardwareTools | null;
  hardwareToolsError?: string;
  history: SdkworkAdminSettingsHistoryEntry[];
  isApplyingBulk: boolean;
  isBootstrapped: boolean;
  isLoadingDevices: boolean;
  isLoadingHardwareTools: boolean;
  isLoadingHistory: boolean;
  isLoadingSettings: boolean;
  isSaving: boolean;
  lastError?: string;
  notice?: string;
  revisionConflict: boolean;
  search: string;
  selectedDeviceId: string | null;
  settings: SdkworkAdminDeviceSettings | null;
  visibleDevices: SdkworkAdminDevice[];
}

export interface SdkworkAdminController {
  applyBulkToSelection(): Promise<boolean>;
  bootstrap(input?: GetSdkworkAdminDevicesInput): Promise<SdkworkAdminControllerState>;
  clearBulkSelection(): void;
  clearOverride(settingKey: string): void;
  discardDraft(): void;
  getState(): SdkworkAdminControllerState;
  loadSettingsHistory(): Promise<void>;
  refreshDevices(input?: GetSdkworkAdminDevicesInput): Promise<SdkworkAdminControllerState>;
  refreshHardwareTools(): Promise<void>;
  resetToDefaults(): Promise<boolean>;
  rollbackSettings(targetRevision: string): Promise<boolean>;
  save(): Promise<boolean>;
  selectDevice(deviceId: string): Promise<void>;
  service: SdkworkAdminService;
  setHealthFilter(healthFilter: SdkworkAdminDeviceHealth | "all"): void;
  setOverride(settingKey: string, value: unknown): void;
  setSearch(search: string): void;
  subscribe(listener: () => void): () => void;
  toggleBulkSelection(deviceId: string): void;
}

export interface CreateSdkworkAdminControllerOptions {
  initialState?: Partial<SdkworkAdminControllerState>;
  service?: Partial<SdkworkAdminService>;
}

const HISTORY_PAGE_SIZE = 20;

function deriveVisibleDevices(
  devices: readonly SdkworkAdminDevice[],
  healthFilter: SdkworkAdminDeviceHealth | "all",
  search: string,
): SdkworkAdminDevice[] {
  const query = search.trim().toLowerCase();
  return devices.filter((device) => {
    if (healthFilter !== "all" && device.health !== healthFilter) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [device.deviceId, device.displayName, device.productId]
      .some((value) => value.toLowerCase().includes(query));
  });
}

function resolveSelectedDeviceId(
  visibleDevices: readonly SdkworkAdminDevice[],
  selectedDeviceId: string | null,
): string | null {
  if (selectedDeviceId && visibleDevices.some((device) => device.deviceId === selectedDeviceId)) {
    return selectedDeviceId;
  }
  return visibleDevices[0]?.deviceId ?? null;
}

function normalizeState(state: SdkworkAdminControllerState): SdkworkAdminControllerState {
  const visibleDevices = deriveVisibleDevices(state.devices, state.healthFilter, state.search);
  const selectedDeviceId = resolveSelectedDeviceId(visibleDevices, state.selectedDeviceId);
  return {
    ...state,
    selectedDeviceId,
    visibleDevices,
  };
}

function emptyState(): SdkworkAdminControllerState {
  return {
    bulkSelection: [],
    devices: [],
    draftErrors: {},
    draftOverrides: {},
    healthFilter: "all",
    hardwareTools: null,
    history: [],
    isApplyingBulk: false,
    isBootstrapped: false,
    isLoadingDevices: false,
    isLoadingHardwareTools: false,
    isLoadingHistory: false,
    isLoadingSettings: false,
    isSaving: false,
    revisionConflict: false,
    search: "",
    selectedDeviceId: null,
    settings: null,
    visibleDevices: [],
  };
}

export function createSdkworkAdminController(
  options: CreateSdkworkAdminControllerOptions = {},
): SdkworkAdminController {
  const service: SdkworkAdminService = options.service
    ? { ...createSdkworkAdminService(), ...options.service }
    : createSdkworkAdminService();
  const listeners = new Set<() => void>();
  let state = normalizeState({ ...emptyState(), ...options.initialState });

  function emit(): void {
    listeners.forEach((listener) => listener());
  }

  function setState(
    next:
      | Partial<SdkworkAdminControllerState>
      | ((current: SdkworkAdminControllerState) => Partial<SdkworkAdminControllerState>),
  ): void {
    const partial = typeof next === "function" ? next(state) : next;
    state = normalizeState({ ...state, ...partial });
    emit();
  }

  function applySettings(settings: SdkworkAdminDeviceSettings): void {
    setState({
      draftErrors: {},
      draftOverrides: { ...settings.overrides },
      isLoadingSettings: false,
      revisionConflict: false,
      settings,
    });
  }

  async function loadHistory(deviceId: string | null): Promise<void> {
    if (!deviceId) {
      setState({ history: [], isLoadingHistory: false });
      return;
    }
    setState({ isLoadingHistory: true });
    try {
      const page = await service.listSettingsHistory(deviceId, {
        page: 1,
        pageSize: HISTORY_PAGE_SIZE,
      });
      setState({ history: page.items, isLoadingHistory: false });
    } catch (error) {
      setState({
        history: [],
        isLoadingHistory: false,
        lastError: describeAdminServiceError(error),
      });
    }
  }

  async function loadHardwareTools(deviceId: string): Promise<void> {
    setState({
      hardwareTools: null,
      hardwareToolsError: undefined,
      isLoadingHardwareTools: true,
    });
    try {
      const tools = await service.listHardwareTools(deviceId);
      setState({ hardwareTools: tools, isLoadingHardwareTools: false });
    } catch (error) {
      setState({
        hardwareTools: null,
        hardwareToolsError: describeAdminServiceError(error),
        isLoadingHardwareTools: false,
      });
    }
  }

  async function loadSettings(deviceId: string): Promise<void> {
    setState({ isLoadingSettings: true, lastError: undefined });
    try {
      const settings = await service.getDeviceSettings(deviceId);
      applySettings(settings);
      await loadHistory(deviceId);
    } catch (error) {
      setState({
        isLoadingSettings: false,
        lastError: describeAdminServiceError(error),
        settings: null,
      });
    }
  }

  return {
    async applyBulkToSelection() {
      const settings = state.settings;
      const deviceIds = state.bulkSelection;
      if (!settings || deviceIds.length === 0) {
        return false;
      }
      setState({
        bulkResult: undefined,
        isApplyingBulk: true,
        lastError: undefined,
        notice: undefined,
      });
      try {
        const result = await service.bulkApplySettings({
          items: deviceIds.map((deviceId) => ({
            deviceId,
            overrides: { ...state.draftOverrides },
          })),
        });
        setState({
          bulkResult: result,
          isApplyingBulk: false,
          notice: `批量应用完成：${summarizeBulkResult(result)}`,
        });
        if (deviceIds.includes(settings.deviceId)) {
          const refreshed = await service.getDeviceSettings(settings.deviceId);
          applySettings(refreshed);
          await loadHistory(settings.deviceId);
        }
        return true;
      } catch (error) {
        setState({
          isApplyingBulk: false,
          lastError: describeAdminServiceError(error),
        });
        return false;
      }
    },

    async bootstrap(input) {
      setState({ isLoadingDevices: true, lastError: undefined });
      try {
        const page = await service.listDevices(input);
        const visibleDevices = deriveVisibleDevices(page.items, state.healthFilter, state.search);
        const selectedDeviceId = resolveSelectedDeviceId(visibleDevices, state.selectedDeviceId);
        setState({
          devices: page.items,
          isBootstrapped: true,
          isLoadingDevices: false,
          selectedDeviceId,
        });
        if (selectedDeviceId) {
          await loadSettings(selectedDeviceId);
          await loadHardwareTools(selectedDeviceId);
        }
        return state;
      } catch (error) {
        setState({
          isLoadingDevices: false,
          lastError: describeAdminServiceError(error),
        });
        throw error;
      }
    },

    clearBulkSelection() {
      setState({ bulkResult: undefined, bulkSelection: [] });
    },

    clearOverride(settingKey) {
      setState((current) => {
        const draftOverrides = { ...current.draftOverrides };
        delete draftOverrides[settingKey];
        return {
          draftErrors: current.settings
            ? validateSettingsDraft(current.settings.definitions, draftOverrides)
            : {},
          draftOverrides,
        };
      });
    },

    discardDraft() {
      setState((current) => ({
        draftErrors: {},
        draftOverrides: current.settings ? { ...current.settings.overrides } : {},
        notice: undefined,
        revisionConflict: false,
      }));
    },

    getState() {
      return state;
    },

    async loadSettingsHistory() {
      await loadHistory(state.selectedDeviceId);
    },

    async refreshDevices(input) {
      return this.bootstrap(input);
    },

    async refreshHardwareTools() {
      if (state.selectedDeviceId) {
        await loadHardwareTools(state.selectedDeviceId);
      }
    },

    async resetToDefaults() {
      const deviceId = state.selectedDeviceId;
      if (!deviceId || !state.settings) {
        return false;
      }
      setState({ isSaving: true, lastError: undefined, notice: undefined });
      try {
        await service.resetDeviceSettings(deviceId);
        const settings = await service.getDeviceSettings(deviceId);
        applySettings(settings);
        await loadHistory(deviceId);
        setState({
          isSaving: false,
          notice: `已恢复继承默认值（revision ${settings.revision}）`,
        });
        return true;
      } catch (error) {
        setState({
          isSaving: false,
          lastError: describeAdminServiceError(error),
        });
        return false;
      }
    },

    async rollbackSettings(targetRevision) {
      const deviceId = state.selectedDeviceId;
      const settings = state.settings;
      if (!deviceId || !settings) {
        return false;
      }
      setState({ isSaving: true, lastError: undefined, notice: undefined });
      try {
        const updated = await service.rollbackDeviceSettings(deviceId, {
          expectedRevision: settings.revision,
          targetRevision,
        });
        applySettings(updated);
        await loadHistory(deviceId);
        setState({
          isSaving: false,
          notice: `已回滚到 revision ${targetRevision}，并生成新 revision ${updated.revision}`,
        });
        return true;
      } catch (error) {
        if (isSettingsRevisionConflict(error)) {
          setState({
            isSaving: false,
            lastError: "另一位管理员已保存该设备的设置，已重新载入最新 revision，请确认后再次回滚。",
            revisionConflict: true,
          });
          try {
            const latest = await service.getDeviceSettings(deviceId);
            setState({ draftErrors: {}, settings: latest });
            await loadHistory(deviceId);
          } catch {
            // Keep the conflict message; the operator can refresh manually.
          }
          return false;
        }
        setState({
          isSaving: false,
          lastError: describeAdminServiceError(error),
        });
        return false;
      }
    },

    async save() {
      const deviceId = state.selectedDeviceId;
      const settings = state.settings;
      if (!deviceId || !settings) {
        return false;
      }
      const draftErrors = validateSettingsDraft(settings.definitions, state.draftOverrides);
      if (Object.keys(draftErrors).length > 0) {
        setState({ draftErrors });
        return false;
      }
      setState({ draftErrors: {}, isSaving: true, lastError: undefined, notice: undefined });
      try {
        const updated = await service.saveDeviceSettings(
          deviceId,
          { overrides: state.draftOverrides },
          settings.revision,
        );
        applySettings(updated);
        await loadHistory(deviceId);
        setState({
          isSaving: false,
          notice: `设置已保存并下发到设备（revision ${updated.revision}，覆盖 ${countOverrides(updated.overrides)} 项）`,
        });
        return true;
      } catch (error) {
        if (isSettingsRevisionConflict(error)) {
          setState({
            isSaving: false,
            lastError: "另一位管理员已保存该设备的设置，已重新载入最新 revision，请确认后再次提交。",
            revisionConflict: true,
          });
          try {
            const latest = await service.getDeviceSettings(deviceId);
            setState({ draftErrors: {}, settings: latest });
            await loadHistory(deviceId);
          } catch {
            // Keep the conflict message; the operator can refresh manually.
          }
          return false;
        }
        setState({
          isSaving: false,
          lastError: describeAdminServiceError(error),
        });
        return false;
      }
    },

    async selectDevice(deviceId) {
      setState({
        draftErrors: {},
        draftOverrides: {},
        hardwareTools: null,
        hardwareToolsError: undefined,
        history: [],
        lastError: undefined,
        notice: undefined,
        revisionConflict: false,
        selectedDeviceId: deviceId,
        settings: null,
      });
      await loadSettings(deviceId);
      await loadHardwareTools(deviceId);
    },

    service,

    setHealthFilter(healthFilter) {
      setState({ healthFilter });
    },

    setOverride(settingKey, value) {
      setState((current) => {
        const draftOverrides = { ...current.draftOverrides, [settingKey]: value };
        return {
          draftErrors: current.settings
            ? validateSettingsDraft(current.settings.definitions, draftOverrides)
            : {},
          draftOverrides,
          notice: undefined,
        };
      });
    },

    setSearch(search) {
      setState({ search });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    toggleBulkSelection(deviceId) {
      setState((current) => ({
        bulkSelection: current.bulkSelection.includes(deviceId)
          ? current.bulkSelection.filter((id) => id !== deviceId)
          : [...current.bulkSelection, deviceId],
      }));
    },
  };
}

export function useSdkworkAdminController(
  controller?: SdkworkAdminController,
  service?: Partial<SdkworkAdminService>,
): SdkworkAdminController {
  return useMemo(
    () => controller ?? createSdkworkAdminController(service ? { service } : undefined),
    [controller, service],
  );
}

export function useSdkworkAdminControllerState(
  controller: SdkworkAdminController,
): SdkworkAdminControllerState {
  return useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
}
