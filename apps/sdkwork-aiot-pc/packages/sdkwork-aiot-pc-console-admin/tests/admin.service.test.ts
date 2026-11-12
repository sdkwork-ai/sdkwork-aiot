import { describe, expect, it, vi } from "vitest";

import type { SdkworkAiotBackendClient } from "@sdkwork/aiot-pc-core";

// The default backend client is never used by these tests: every service is
// constructed with an injected fake client. Mocking the PC core boundary keeps
// the tests independent from the generated transport graph.
vi.mock("@sdkwork/aiot-pc-core", () => ({
  getAiotBackendSdkClient: () => {
    throw new Error("tests must inject a backend client");
  },
}));

import {
  createSdkworkAdminService,
  describeAdminServiceError,
  isSettingsRevisionConflict,
} from "../src";

interface FakeBackend {
  bulkUpdate: ReturnType<typeof vi.fn>;
  deviceList: ReturnType<typeof vi.fn>;
  hardwareToolsList: ReturnType<typeof vi.fn>;
  historyList: ReturnType<typeof vi.fn>;
  resetSettings: ReturnType<typeof vi.fn>;
  retrieveSettings: ReturnType<typeof vi.fn>;
  rollbackSettings: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
}

function createFakeBackend(): { backend: FakeBackend; client: SdkworkAiotBackendClient } {
  const backend: FakeBackend = {
    bulkUpdate: vi.fn(),
    deviceList: vi.fn(),
    hardwareToolsList: vi.fn(),
    historyList: vi.fn(),
    resetSettings: vi.fn(),
    retrieveSettings: vi.fn(),
    rollbackSettings: vi.fn(),
    updateSettings: vi.fn(),
  };
  const client = {
    iot: {
      deviceSettings: {
        bulkUpdate: backend.bulkUpdate,
      },
      devices: {
        hardwareTools: {
          list: backend.hardwareToolsList,
        },
        list: backend.deviceList,
        settings: {
          delete: backend.resetSettings,
          history: {
            list: backend.historyList,
          },
          retrieve: backend.retrieveSettings,
          rollback: backend.rollbackSettings,
          update: backend.updateSettings,
        },
      },
    },
  } as unknown as SdkworkAiotBackendClient;
  return { backend, client };
}

function settingsPayload(overrides: Record<string, unknown> = {}, revision = "2") {
  return {
    capabilityModelId: "capmodel-xiaozhi-core",
    defaults: { "audio.volume": 60 },
    definitions: [
      {
        displayName: "Volume",
        kind: "integer",
        maximum: 100,
        minimum: 0,
        settingKey: "audio.volume",
        unit: "%",
      },
    ],
    deviceId: "device-1",
    effective: { "audio.volume": overrides["audio.volume"] ?? 60 },
    overrides,
    productId: "9001",
    revision,
  };
}

describe("sdkwork-aiot-pc-console-admin service", () => {
  it("maps the admin device page and requests the first page by default", async () => {
    const { backend, client } = createFakeBackend();
    backend.deviceList.mockResolvedValue({
      items: [
        { deviceId: "device-1", displayName: "Speaker", productId: "9001", status: "online" },
        { displayName: "Broken row" },
      ],
      pageInfo: { hasMore: false, mode: "offset", page: 1, pageSize: 50, total: 2 },
    });
    const service = createSdkworkAdminService({ backendClient: client });

    const page = await service.listDevices();

    expect(backend.deviceList).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      deviceId: "device-1",
      displayName: "Speaker",
      health: "healthy",
    });
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(false);
  });

  it("maps the live hardware tool catalog for one device", async () => {
    const { backend, client } = createFakeBackend();
    backend.hardwareToolsList.mockResolvedValue({
      deviceId: "device-1",
      discovered: true,
      online: true,
      tools: [
        {
          description: "Set volume",
          inputSchema: { type: "object", properties: { volume: { type: "integer" } } },
          name: "self.audio_speaker.set_volume",
        },
        { description: "Take photo", inputSchema: {}, name: "self.camera.take_photo" },
      ],
    });
    const service = createSdkworkAdminService({ backendClient: client });

    const catalog = await service.listHardwareTools("device-1");

    expect(backend.hardwareToolsList).toHaveBeenCalledWith("device-1");
    expect(catalog.online).toBe(true);
    expect(catalog.discovered).toBe(true);
    expect(catalog.tools).toHaveLength(2);
    expect(catalog.tools[0].name).toBe("self.audio_speaker.set_volume");
    expect(catalog.tools[0].inputSchema.type).toBe("object");
  });

  it("sends the current revision with the replaced overrides map", async () => {
    const { backend, client } = createFakeBackend();
    backend.updateSettings.mockResolvedValue(settingsPayload({ "audio.volume": 25 }, "3"));
    const service = createSdkworkAdminService({ backendClient: client });

    const updated = await service.saveDeviceSettings(
      "device-1",
      { overrides: { "audio.volume": 25 } },
      "2",
    );

    expect(backend.updateSettings).toHaveBeenCalledWith("device-1", {
      expectedRevision: "2",
      overrides: { "audio.volume": 25 },
    });
    expect(updated.revision).toBe("3");
    expect(updated.overrides["audio.volume"]).toBe(25);
  });

  it("drops values that cannot be encoded as JSON before the request", async () => {
    const { backend, client } = createFakeBackend();
    backend.updateSettings.mockResolvedValue(settingsPayload());
    const service = createSdkworkAdminService({ backendClient: client });

    await service.saveDeviceSettings(
      "device-1",
      { overrides: { "audio.volume": 30, "assistant.broken": Number.NaN } },
      "0",
    );

    expect(backend.updateSettings).toHaveBeenCalledWith("device-1", {
      expectedRevision: "0",
      overrides: { "audio.volume": 30 },
    });
  });

  it("resets settings through the delete operation", async () => {
    const { backend, client } = createFakeBackend();
    backend.resetSettings.mockResolvedValue(undefined);
    const service = createSdkworkAdminService({ backendClient: client });

    await service.resetDeviceSettings("device-1");

    expect(backend.resetSettings).toHaveBeenCalledWith("device-1");
  });

  it("classifies revision conflicts and safe error messages", () => {
    expect(isSettingsRevisionConflict({ httpStatus: 409 })).toBe(true);
    expect(isSettingsRevisionConflict({ problem: { code: 40901 } })).toBe(true);
    expect(isSettingsRevisionConflict({ code: "CONFLICT" })).toBe(true);
    expect(isSettingsRevisionConflict({ httpStatus: 422 })).toBe(false);
    expect(isSettingsRevisionConflict(new Error("boom"))).toBe(false);
    expect(describeAdminServiceError(new Error("network down"))).toBe("network down");
    expect(describeAdminServiceError(undefined)).toBe("The IoT admin request failed.");
  });

  it("maps the settings revision history page", async () => {
    const { backend, client } = createFakeBackend();
    backend.historyList.mockResolvedValue({
      items: [
        {
          action: "rollback",
          changedKeys: ["audio.volume", "display.brightness"],
          overrides: { "audio.volume": 30 },
          revision: "4",
          updatedAt: "2026-11-12T01:00:00Z",
          updatedBy: "1001",
        },
      ],
      pageInfo: { hasMore: false, mode: "offset", page: 1, pageSize: 20, total: 1 },
    });
    const service = createSdkworkAdminService({ backendClient: client });

    const page = await service.listSettingsHistory("device-1");

    expect(backend.historyList).toHaveBeenCalledWith("device-1", { page: 1, pageSize: 20 });
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      action: "rollback",
      changedKeys: ["audio.volume", "display.brightness"],
      revision: "4",
    });
  });

  it("sends rollback and bulk update requests through the SDK boundary", async () => {
    const { backend, client } = createFakeBackend();
    backend.rollbackSettings.mockResolvedValue(settingsPayload({ "audio.volume": 30 }, "5"));
    backend.bulkUpdate.mockResolvedValue({
      allOrNothing: true,
      items: [
        { deviceId: "device-1", errors: [], revision: "6", status: "updated" },
        {
          deviceId: "device-2",
          errors: [{ code: 40011, field: "overrides.audio.volume", message: "Must be at most 100." }],
          status: "invalid",
        },
      ],
    });
    const service = createSdkworkAdminService({ backendClient: client });

    const rolledBack = await service.rollbackDeviceSettings("device-1", {
      expectedRevision: "4",
      targetRevision: "3",
    });
    expect(backend.rollbackSettings).toHaveBeenCalledWith("device-1", {
      expectedRevision: "4",
      targetRevision: "3",
    });
    expect(rolledBack.revision).toBe("5");

    const bulk = await service.bulkApplySettings({
      allOrNothing: true,
      items: [
        { deviceId: "device-1", expectedRevision: "5", overrides: { "audio.volume": 40 } },
        { deviceId: "device-2", overrides: { "audio.volume": 400 } },
      ],
    });
    expect(backend.bulkUpdate).toHaveBeenCalledWith({
      allOrNothing: true,
      items: [
        { deviceId: "device-1", expectedRevision: "5", overrides: { "audio.volume": 40 } },
        { deviceId: "device-2", overrides: { "audio.volume": 400 } },
      ],
    });
    expect(bulk.items.map((item) => item.status)).toEqual(["updated", "invalid"]);
    expect(bulk.items[1].errors[0].field).toBe("overrides.audio.volume");
  });
});
