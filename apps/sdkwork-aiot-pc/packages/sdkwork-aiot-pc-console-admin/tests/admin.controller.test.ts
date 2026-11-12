import { describe, expect, it, vi } from "vitest";

// Controllers are always constructed with an injected service in these tests.
// Mocking the PC core boundary keeps the suite independent from the generated
// transport graph.
vi.mock("@sdkwork/aiot-pc-core", () => ({
  getAiotBackendSdkClient: () => {
    throw new Error("tests must inject an admin service");
  },
}));

import {
  createSdkworkAdminController,
  type SdkworkAdminService,
} from "../src";
import type {
  SdkworkAdminBulkApplyInput,
  SdkworkAdminDevice,
  SdkworkAdminDeviceSettings,
  SdkworkAdminSettingsHistoryEntry,
} from "../src";

const DEVICES: SdkworkAdminDevice[] = [
  {
    chipFamily: "esp32_s3",
    deviceId: "device-a",
    displayName: "Kitchen Speaker",
    health: "healthy",
    lastSeenAt: "2026-11-12T00:00:00Z",
    productId: "9001",
    status: "online",
  },
  {
    chipFamily: "esp32_s3",
    deviceId: "device-b",
    displayName: "Bedroom Speaker",
    health: "warning",
    lastSeenAt: "2026-11-11T00:00:00Z",
    productId: "9001",
    status: "warning",
  },
];

function settingsFor(
  deviceId: string,
  overrides: Record<string, unknown> = {},
  revision = "0",
): SdkworkAdminDeviceSettings {
  return {
    capabilityModelId: "capmodel-xiaozhi-core",
    defaults: { "audio.volume": 60, "assistant.wakeWord": "你好小智" },
    definitions: [
      {
        displayName: "Volume",
        group: "audio",
        kind: "integer",
        maximum: 100,
        minimum: 0,
        options: [],
        required: false,
        sensitive: false,
        settingKey: "audio.volume",
        writable: true,
      },
      {
        displayName: "Wake word",
        group: "assistant",
        kind: "enum",
        options: [
          { label: "默认唤醒词", value: "你好小智" },
          { label: "备用唤醒词", value: "小智小智" },
        ],
        required: false,
        sensitive: false,
        settingKey: "assistant.wakeWord",
        writable: true,
      },
    ],
    deviceId,
    effective: { "audio.volume": 60, "assistant.wakeWord": "你好小智", ...overrides },
    overrides,
    productId: "9001",
    revision,
  };
}

function historyFor(revision = "1"): SdkworkAdminSettingsHistoryEntry {
  return {
    action: "update",
    changedKeys: ["audio.volume"],
    overrides: { "audio.volume": 30 },
    revision,
    updatedAt: "2026-11-12T00:00:00Z",
    updatedBy: "1001",
  };
}

function createService(): SdkworkAdminService {
  return {
    bulkApplySettings: vi.fn(async (input: SdkworkAdminBulkApplyInput) => ({
      allOrNothing: input.allOrNothing ?? false,
      items: input.items.map((item) => ({
        deviceId: item.deviceId,
        errors: [],
        revision: "1",
        status: "updated" as const,
      })),
    })),
    getDeviceSettings: vi.fn(async (deviceId: string) => settingsFor(deviceId)),
    invokeHardwareTool: vi.fn(async (deviceId: string, toolName: string) => ({
      deviceId,
      result: { content: [{ text: "ok", type: "text" }] },
      toolName,
    })),
    listHardwareTools: vi.fn(async (deviceId: string) => ({
      deviceId,
      discovered: true,
      online: true,
      tools: [
        {
          description: "Set volume",
          inputSchema: { type: "object" },
          name: "self.audio_speaker.set_volume",
        },
      ],
    })),
    listDevices: vi.fn(async () => ({
      hasMore: false,
      items: DEVICES,
      page: 1,
      pageSize: 50,
      total: DEVICES.length,
    })),
    listSettingsHistory: vi.fn(async () => ({ items: [historyFor()], total: 1 })),
    resetDeviceSettings: vi.fn(async () => undefined),
    rollbackDeviceSettings: vi.fn(async (deviceId, input) =>
      settingsFor(deviceId, { "audio.volume": 30 }, String(Number(input.targetRevision) + 1)),
    ),
    saveDeviceSettings: vi.fn(async (deviceId, draft, expectedRevision) =>
      settingsFor(deviceId, draft.overrides, String(Number(expectedRevision) + 1)),
    ),
  };
}

describe("sdkwork-aiot-pc-console-admin controller", () => {
  it("bootstraps the inventory and loads the first device settings", async () => {
    const service = createService();
    const controller = createSdkworkAdminController({ service });

    await controller.bootstrap();

    const state = controller.getState();
    expect(state.isBootstrapped).toBe(true);
    expect(state.devices).toHaveLength(2);
    expect(state.selectedDeviceId).toBe("device-a");
    expect(state.settings?.deviceId).toBe("device-a");
    expect(state.draftOverrides).toEqual({});
    expect(state.history).toHaveLength(1);
    expect(state.history[0].revision).toBe("1");
    expect(service.listDevices).toHaveBeenCalledTimes(1);
    expect(service.getDeviceSettings).toHaveBeenCalledWith("device-a");
    expect(service.listSettingsHistory).toHaveBeenCalledWith("device-a", {
      page: 1,
      pageSize: 20,
    });
    expect(service.listHardwareTools).toHaveBeenCalledWith("device-a");
    expect(state.hardwareTools?.online).toBe(true);
    expect(state.hardwareTools?.tools[0]?.name).toBe("self.audio_speaker.set_volume");
  });


  it("invokes a hardware tool with parsed arguments and surfaces invalid JSON", async () => {
    const service = createService();
    const controller = createSdkworkAdminController({ service });
    await controller.bootstrap();

    const ok = await controller.invokeHardwareTool(
      "self.audio_speaker.set_volume",
      '{"volume": 30}',
    );
    expect(ok).toBe(true);
    expect(service.invokeHardwareTool).toHaveBeenCalledWith(
      "device-a",
      "self.audio_speaker.set_volume",
      { volume: 30 },
    );
    expect(controller.getState().hardwareToolInvocation?.toolName).toBe(
      "self.audio_speaker.set_volume",
    );
    expect(controller.getState().hardwareToolNotice).toContain("调用完成");

    const invalid = await controller.invokeHardwareTool(
      "self.audio_speaker.set_volume",
      "[1,2]",
    );
    expect(invalid).toBe(false);
    expect(controller.getState().hardwareToolError).toContain("JSON object");
  });

  it("filters devices by search and health and selects another device", async () => {
    const service = createService();
    const controller = createSdkworkAdminController({ service });
    await controller.bootstrap();

    controller.setSearch("bedroom");
    expect(controller.getState().visibleDevices.map((device) => device.deviceId)).toEqual([
      "device-b",
    ]);
    expect(controller.getState().selectedDeviceId).toBe("device-b");

    controller.setSearch("");
    controller.setHealthFilter("healthy");
    expect(controller.getState().visibleDevices.map((device) => device.deviceId)).toEqual([
      "device-a",
    ]);

    await controller.selectDevice("device-b");
    expect(service.getDeviceSettings).toHaveBeenLastCalledWith("device-b");
    expect(controller.getState().settings?.deviceId).toBe("device-b");
  });

  it("tracks draft overrides, validates them, and discards changes", async () => {
    const service = createService();
    const controller = createSdkworkAdminController({ service });
    await controller.bootstrap();

    controller.setOverride("audio.volume", 140);
    expect(controller.getState().draftOverrides["audio.volume"]).toBe(140);
    expect(controller.getState().draftErrors["audio.volume"]).toBe("Must be at most 100.");

    controller.setOverride("audio.volume", 30);
    expect(controller.getState().draftErrors).toEqual({});

    controller.clearOverride("audio.volume");
    expect(controller.getState().draftOverrides).toEqual({});

    controller.setOverride("assistant.wakeWord", "小智小智");
    controller.discardDraft();
    expect(controller.getState().draftOverrides).toEqual({});
  });

  it("saves with the loaded revision and publishes a success notice", async () => {
    const service = createService();
    const controller = createSdkworkAdminController({ service });
    await controller.bootstrap();
    controller.setOverride("audio.volume", 25);

    const saved = await controller.save();

    expect(saved).toBe(true);
    expect(service.saveDeviceSettings).toHaveBeenCalledWith(
      "device-a",
      { overrides: { "audio.volume": 25 } },
      "0",
    );
    expect(controller.getState().settings?.revision).toBe("1");
    expect(controller.getState().draftOverrides).toEqual({ "audio.volume": 25 });
    expect(controller.getState().notice).toContain("revision 1");
    expect(controller.getState().isSaving).toBe(false);
  });

  it("blocks invalid drafts from reaching the API", async () => {
    const service = createService();
    const controller = createSdkworkAdminController({ service });
    await controller.bootstrap();
    controller.setOverride("audio.volume", "not-a-number");

    const saved = await controller.save();

    expect(saved).toBe(false);
    expect(service.saveDeviceSettings).not.toHaveBeenCalled();
    expect(controller.getState().draftErrors["audio.volume"]).toBe("Must be a whole number.");
  });

  it("reloads settings and reports a conflict when another operator saved first", async () => {
    const service = createService();
    const conflict = Object.assign(new Error("revision conflict"), { httpStatus: 409 });
    vi.mocked(service.saveDeviceSettings).mockRejectedValueOnce(conflict);
    const controller = createSdkworkAdminController({ service });
    await controller.bootstrap();
    vi.mocked(service.getDeviceSettings).mockResolvedValueOnce(settingsFor("device-a", {}, "5"));
    controller.setOverride("audio.volume", 25);

    const saved = await controller.save();

    expect(saved).toBe(false);
    expect(controller.getState().revisionConflict).toBe(true);
    expect(controller.getState().lastError).toContain("另一位管理员");
    expect(controller.getState().settings?.revision).toBe("5");
    expect(controller.getState().isSaving).toBe(false);
  });

  it("resets overrides back to the inherited defaults", async () => {
    const service = createService();
    vi.mocked(service.getDeviceSettings)
      .mockResolvedValueOnce(settingsFor("device-a", { "audio.volume": 20 }, "2"))
      .mockResolvedValue(settingsFor("device-a", {}, "3"));
    const controller = createSdkworkAdminController({ service });
    await controller.bootstrap();
    expect(controller.getState().settings?.overrides).toEqual({ "audio.volume": 20 });

    const reset = await controller.resetToDefaults();

    expect(reset).toBe(true);
    expect(service.resetDeviceSettings).toHaveBeenCalledWith("device-a");
    expect(controller.getState().settings?.overrides).toEqual({});
    expect(controller.getState().notice).toContain("默认值");
  });

  it("rolls back to a recorded revision with the current revision as the guard", async () => {
    const service = createService();
    vi.mocked(service.getDeviceSettings).mockResolvedValue(settingsFor("device-a", {}, "3"));
    const controller = createSdkworkAdminController({ service });
    await controller.bootstrap();

    const rolledBack = await controller.rollbackSettings("1");

    expect(rolledBack).toBe(true);
    expect(service.rollbackDeviceSettings).toHaveBeenCalledWith("device-a", {
      expectedRevision: "3",
      targetRevision: "1",
    });
    expect(controller.getState().settings?.revision).toBe("2");
    expect(controller.getState().notice).toContain("revision 1");
    expect(controller.getState().isSaving).toBe(false);
    expect(service.listSettingsHistory).toHaveBeenCalledTimes(2);
  });

  it("tracks bulk selection and applies the current draft to selected devices", async () => {
    const service = createService();
    const controller = createSdkworkAdminController({ service });
    await controller.bootstrap();
    controller.setOverride("audio.volume", 45);

    controller.toggleBulkSelection("device-a");
    controller.toggleBulkSelection("device-b");
    expect(controller.getState().bulkSelection).toEqual(["device-a", "device-b"]);

    const applied = await controller.applyBulkToSelection();

    expect(applied).toBe(true);
    expect(service.bulkApplySettings).toHaveBeenCalledWith({
      items: [
        { deviceId: "device-a", overrides: { "audio.volume": 45 } },
        { deviceId: "device-b", overrides: { "audio.volume": 45 } },
      ],
    });
    expect(controller.getState().bulkResult?.items).toHaveLength(2);
    expect(controller.getState().notice).toContain("批量应用完成");
    expect(controller.getState().isApplyingBulk).toBe(false);

    controller.toggleBulkSelection("device-a");
    expect(controller.getState().bulkSelection).toEqual(["device-b"]);
    controller.clearBulkSelection();
    expect(controller.getState().bulkSelection).toEqual([]);
    expect(controller.getState().bulkResult).toBeUndefined();
  });
});
