import { describe, expect, it } from "vitest";

import {
  countOverrides,
  formatSettingValue,
  formatSettingsChangeAction,
  groupSettingDefinitions,
  isSettingOverridden,
  mapAdminDeviceRecord,
  mapAdminDeviceSettings,
  hardwareToolParameters,
  mapBulkResult,
  mapHardwareTools,
  mapSettingsHistoryEntry,
  mapSettingsHistoryPage,
  parseSettingInput,
  summarizeBulkResult,
  validateSettingsDraft,
  type SdkworkAdminDeviceSettings,
  type SdkworkAdminSettingDefinition,
} from "../src/admin";

function definitions(): SdkworkAdminSettingDefinition[] {
  return [
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
      unit: "%",
      writable: true,
      defaultValue: 60,
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
      defaultValue: "你好小智",
    },
    {
      displayName: "Require mutual TLS",
      group: "security",
      kind: "boolean",
      options: [],
      required: false,
      sensitive: false,
      settingKey: "security.requireMtls",
      writable: false,
      defaultValue: true,
    },
  ];
}

function settingsFixture(): SdkworkAdminDeviceSettings {
  return {
    capabilityModelId: "capmodel-xiaozhi-core",
    defaults: { "audio.volume": 60, "assistant.wakeWord": "你好小智" },
    definitions: definitions(),
    deviceId: "device-1",
    effective: { "audio.volume": 60, "assistant.wakeWord": "你好小智" },
    overrides: {},
    productId: "9001",
    revision: "0",
  };
}

describe("admin domain model", () => {
  it("maps admin device records and normalizes health from status", () => {
    expect(
      mapAdminDeviceRecord({
        deviceId: "device-1",
        displayName: "Kitchen Speaker",
        productId: "9001",
        status: "online",
        chipFamily: "esp32_s3",
        lastSeenAt: "2026-11-12T00:00:00Z",
      }),
    ).toEqual({
      chipFamily: "esp32_s3",
      deviceId: "device-1",
      displayName: "Kitchen Speaker",
      health: "healthy",
      lastSeenAt: "2026-11-12T00:00:00Z",
      productId: "9001",
      status: "online",
    });
    expect(mapAdminDeviceRecord({ status: "online" })).toBeNull();
    expect(mapAdminDeviceRecord({ id: "device-2", status: "degraded" })?.health).toBe("warning");
    expect(mapAdminDeviceRecord({ id: "device-3", status: "offline" })?.health).toBe("offline");
  });

  it("maps device settings payloads and keeps revision as an int64 string", () => {
    const mapped = mapAdminDeviceSettings({
      capabilityModelId: "capmodel-xiaozhi-core",
      defaults: { "audio.volume": 60 },
      definitions: [
        {
          settingKey: "audio.volume",
          displayName: "Volume",
          kind: "integer",
          defaultValue: 60,
          minimum: 0,
          maximum: 100,
          unit: "%",
        },
      ],
      deviceId: "device-1",
      effective: { "audio.volume": 35 },
      overrides: { "audio.volume": 35 },
      productId: "9001",
      revision: "3",
    });
    expect(mapped.revision).toBe("3");
    expect(mapped.definitions[0]).toMatchObject({
      displayName: "Volume",
      group: "General",
      kind: "integer",
      maximum: 100,
      minimum: 0,
      options: [],
      required: false,
      writable: true,
    });
    expect(mapped.overrides["audio.volume"]).toBe(35);
    expect(countOverrides(mapped.overrides)).toBe(1);
  });

  it("groups definitions by declared group while preserving first-seen order", () => {
    const groups = groupSettingDefinitions(definitions());
    expect(groups.map((group) => group.group)).toEqual(["audio", "assistant", "security"]);
    expect(groups[1].definitions[0].settingKey).toBe("assistant.wakeWord");
  });

  it("detects device-level overrides against the inherited defaults", () => {
    const settings = settingsFixture();
    expect(isSettingOverridden(settings, "audio.volume")).toBe(false);
    settings.overrides = { "audio.volume": 20 };
    expect(isSettingOverridden(settings, "audio.volume")).toBe(true);
  });

  it("formats enum labels and JSON values for operator display", () => {
    const [, wakeWord] = definitions();
    expect(formatSettingValue(wakeWord, "小智小智")).toBe("备用唤醒词");
    expect(
      formatSettingValue(
        {
          displayName: "Extra",
          group: "General",
          kind: "json",
          options: [],
          required: false,
          sensitive: false,
          settingKey: "assistant.extra",
          writable: true,
        },
        { enabled: true },
      ),
    ).toContain('"enabled": true');
  });
});

describe("admin settings parsing and validation", () => {
  const [volume, wakeWord, requireMtls] = definitions();

  it("parses operator input into typed JSON values", () => {
    expect(parseSettingInput(volume, "42")).toEqual({ ok: true, value: 42 });
    expect(parseSettingInput(volume, "42.5")).toMatchObject({ ok: false });
    expect(parseSettingInput(volume, "140")).toEqual({
      message: "Must be at most 100.",
      ok: false,
    });
    expect(parseSettingInput(wakeWord, "小智小智")).toEqual({
      ok: true,
      value: "小智小智",
    });
    expect(parseSettingInput(wakeWord, "unknown")).toMatchObject({ ok: false });
    expect(parseSettingInput(requireMtls, "true")).toMatchObject({ ok: false });
    expect(parseSettingInput(volume, true)).toMatchObject({ ok: false });
  });

  it("reports per-field draft errors for unknown, read-only, and invalid values", () => {
    const errors = validateSettingsDraft(definitions(), {
      "audio.volume": 140,
      "assistant.missing": "x",
      "security.requireMtls": false,
    });
    expect(errors["audio.volume"]).toBe("Must be at most 100.");
    expect(errors["assistant.missing"]).toContain("not defined");
    expect(errors["security.requireMtls"]).toContain("read-only");
  });

  it("treats the inherited default as satisfying a required setting", () => {
    const requiredDefinition: SdkworkAdminSettingDefinition = {
      ...volume,
      defaultValue: undefined,
      required: true,
    };
    expect(validateSettingsDraft([requiredDefinition], {})).toEqual({
      "audio.volume": "This setting is required.",
    });
    expect(
      validateSettingsDraft(
        [{ ...requiredDefinition, defaultValue: 10 }],
        {},
      ),
    ).toEqual({});
  });

  it("maps settings history entries and bulk results defensively", () => {
    const history = mapSettingsHistoryEntry({
      action: "rollback",
      changedKeys: ["audio.volume"],
      overrides: { "audio.volume": 30 },
      revision: 4,
      updatedAt: "2026-11-12T02:00:00Z",
      updatedBy: "1001",
    });
    expect(history).toMatchObject({
      action: "rollback",
      changedKeys: ["audio.volume"],
      revision: "4",
    });
    expect(formatSettingsChangeAction("reset")).toBe("恢复默认值");

    const page = mapSettingsHistoryPage({
      items: [{ revision: "2", action: "update", changedKeys: [], overrides: {}, updatedAt: "t" }],
      pageInfo: { total: 1 },
    });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);

    const bulk = mapBulkResult({
      allOrNothing: true,
      items: [
        { deviceId: "device-1", status: "updated", revision: "3", errors: [] },
        {
          deviceId: "device-2",
          status: "invalid",
          errors: [{ code: 40011, field: "overrides.audio.volume", message: "Must be at most 100." }],
        },
        { deviceId: "device-3", status: "unexpected" },
      ],
    });
    expect(bulk.allOrNothing).toBe(true);
    expect(bulk.items.map((item) => item.status)).toEqual(["updated", "invalid", "failed"]);
    expect(bulk.items[0].revision).toBe("3");
    expect(bulk.items[1].errors[0].field).toBe("overrides.audio.volume");
    expect(summarizeBulkResult(bulk)).toBe("已更新 1 · 校验失败 1 · 失败 1");
  });

  it("maps the MCP hardware tool catalog and its parameter names", () => {
    const catalog = mapHardwareTools({
      deviceId: "device-9",
      discovered: true,
      online: true,
      tools: [
        {
          description: "Set volume",
          inputSchema: { properties: { volume: {}, channel: {} }, type: "object" },
          name: "self.audio_speaker.set_volume",
        },
        { description: "", inputSchema: null, name: "  " },
      ],
    });

    expect(catalog.online).toBe(true);
    expect(catalog.discovered).toBe(true);
    expect(catalog.tools).toHaveLength(1);
    expect(catalog.tools[0].name).toBe("self.audio_speaker.set_volume");
    expect(hardwareToolParameters(catalog.tools[0])).toEqual(["channel", "volume"]);
  });

  it("reports offline hardware tool catalogs without tools", () => {
    const catalog = mapHardwareTools({ deviceId: "device-9", online: false }, "fallback");

    expect(catalog.deviceId).toBe("device-9");
    expect(catalog.online).toBe(false);
    expect(catalog.discovered).toBe(false);
    expect(catalog.tools).toEqual([]);
  });
});
