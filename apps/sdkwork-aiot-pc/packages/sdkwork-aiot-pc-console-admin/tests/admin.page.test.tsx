import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { SdkworkThemeProvider } from "@sdkwork/ui-pc-react/theme";

vi.mock("@sdkwork/aiot-pc-core", () => ({
  getAiotBackendSdkClient: () => {
    throw new Error("tests must inject an admin service");
  },
}));

import {
  createSdkworkAdminController,
  SdkworkAdminPage,
  type SdkworkAdminBulkApplyInput,
  type SdkworkAdminController,
  type SdkworkAdminDevice,
  type SdkworkAdminDeviceSettings,
  type SdkworkAdminService,
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
    defaults: { "assistant.wakeWord": "你好小智", "audio.volume": 60 },
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
        unit: "%",
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
    effective: { "assistant.wakeWord": "你好小智", "audio.volume": 60, ...overrides },
    overrides,
    productId: "9001",
    revision,
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
      result: { content: [{ text: "volume accepted", type: "text" }] },
      toolName,
    })),
    listHardwareTools: vi.fn(async (deviceId: string) => ({
      deviceId,
      discovered: true,
      online: true,
      tools: [
        {
          description: "Set volume",
          inputSchema: { type: "object", properties: { volume: { type: "integer" } } },
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
    listSettingsHistory: vi.fn(async () => ({
      items: [
        {
          action: "update" as const,
          changedKeys: ["audio.volume"],
          overrides: { "audio.volume": 30 },
          revision: "1",
          updatedAt: "2026-11-12T01:00:00Z",
          updatedBy: "1001",
        },
        {
          action: "update" as const,
          changedKeys: ["audio.volume", "assistant.wakeWord"],
          overrides: {},
          revision: "0",
          updatedAt: "2026-11-12T00:00:00Z",
        },
      ],
      total: 2,
    })),
    resetDeviceSettings: vi.fn(async () => undefined),
    rollbackDeviceSettings: vi.fn(async (deviceId, input) =>
      settingsFor(deviceId, { "audio.volume": 30 }, String(Number(input.targetRevision) + 1)),
    ),
    saveDeviceSettings: vi.fn(async (deviceId, draft, expectedRevision) =>
      settingsFor(deviceId, draft.overrides, String(Number(expectedRevision) + 1)),
    ),
  };
}

function renderPage(controller: SdkworkAdminController) {
  return render(
    <SdkworkThemeProvider defaultTheme="light">
      <SdkworkAdminPage controller={controller} />
    </SdkworkThemeProvider>,
  );
}

describe("sdkwork-aiot-pc-console-admin page", () => {
  it("lists devices, edits a per-device override, and saves it with the current revision", async () => {
    const service = createService();
    const controller = createSdkworkAdminController({ service });
    renderPage(controller);

    expect(
      await screen.findByRole("heading", { name: /设备管理控制台/ }),
    ).toBeInTheDocument();

    expect(await screen.findByRole("button", { name: /Kitchen Speaker/ })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "device-a" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Bedroom Speaker/ }));
    expect(
      await screen.findByRole("heading", { name: "device-b" }),
    ).toBeInTheDocument();

    const wakeWordSelect = await screen.findByRole("combobox", { name: /Wake word/i });
    expect(wakeWordSelect).toHaveValue("你好小智");

    fireEvent.change(wakeWordSelect, { target: { value: "小智小智" } });
    expect(wakeWordSelect).toHaveValue("小智小智");

    fireEvent.click(screen.getByRole("button", { name: /保存并下发/ }));

    await waitFor(() => {
      expect(service.saveDeviceSettings).toHaveBeenCalledWith(
        "device-b",
        { overrides: { "assistant.wakeWord": "小智小智" } },
        "0",
      );
    });
    expect(await screen.findByText(/设置已更新/)).toBeInTheDocument();
    expect(await screen.findByText(/覆盖 1 项/)).toBeInTheDocument();
  });

  it("shows validation feedback without calling the admin API", async () => {
    const service = createService();
    const controller = createSdkworkAdminController({ service });
    renderPage(controller);

    await screen.findByRole("heading", { name: "device-a" });
    const volumeInput = await screen.findByRole("spinbutton", { name: /Volume/i });

    fireEvent.change(volumeInput, { target: { value: "140" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Must be at most 100.");
    fireEvent.click(screen.getByRole("button", { name: /保存并下发/ }));

    expect(service.saveDeviceSettings).not.toHaveBeenCalled();
  });

  it("shows an empty state when a device has no configurable settings", async () => {
    const service = createService();
    vi.mocked(service.getDeviceSettings).mockResolvedValue({
      capabilityModelId: "capmodel-empty",
      defaults: {},
      definitions: [],
      deviceId: "device-a",
      effective: {},
      overrides: {},
      productId: "9002",
      revision: "0",
    });
    const controller = createSdkworkAdminController({ service });
    renderPage(controller);

    expect(await screen.findByText(/No configurable settings/)).toBeInTheDocument();
  });

  it("shows the revision history and rolls back to an older revision", async () => {
    const service = createService();
    const controller = createSdkworkAdminController({ service });
    renderPage(controller);

    await screen.findByRole("heading", { name: "device-a" });
    expect(await screen.findByText(/变更历史/)).toBeInTheDocument();
    expect(await screen.findByText("r1")).toBeInTheDocument();

    const rollbackButtons = await screen.findAllByRole("button", { name: /回滚到此版本/ });
    // r0 is the current revision, so only the r1 entry can be rolled back.
    expect(rollbackButtons).toHaveLength(2);
    expect(rollbackButtons[0]).toBeEnabled();
    expect(rollbackButtons[1]).toBeDisabled();

    fireEvent.click(rollbackButtons[0]);

    await waitFor(() => {
      expect(service.rollbackDeviceSettings).toHaveBeenCalledWith("device-a", {
        expectedRevision: "0",
        targetRevision: "1",
      });
    });
    expect(await screen.findByText(/已回滚到 revision 1/)).toBeInTheDocument();
  });

  it("selects devices and bulk applies the current draft", async () => {
    const service = createService();
    const controller = createSdkworkAdminController({ service });
    renderPage(controller);

    await screen.findByRole("heading", { name: "device-a" });
    const volumeInput = await screen.findByRole("spinbutton", { name: /Volume/i });
    fireEvent.change(volumeInput, { target: { value: "45" } });

    fireEvent.click(screen.getByRole("checkbox", { name: /批量选择 Kitchen Speaker/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /批量选择 Bedroom Speaker/ }));
    expect(await screen.findByText(/已选择 2 台设备/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /批量应用当前草稿/ }));

    await waitFor(() => {
      expect(service.bulkApplySettings).toHaveBeenCalledWith({
        items: [
          { deviceId: "device-a", overrides: { "audio.volume": 45 } },
          { deviceId: "device-b", overrides: { "audio.volume": 45 } },
        ],
      });
    });
    expect(await screen.findByText(/批量应用完成/)).toBeInTheDocument();
  });

  it("renders the discovered hardware tools from the live MCP catalog", async () => {
    const service = createService();
    const controller = createSdkworkAdminController({ service });
    renderPage(controller);

    expect(
      await screen.findByRole("heading", { name: "设备硬件能力" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("self.audio_speaker.set_volume"),
    ).toBeInTheDocument();
    expect(await screen.findByText(/参数：volume/)).toBeInTheDocument();
    expect(service.listHardwareTools).toHaveBeenCalledWith("device-a");
  });

  it("invokes a discovered hardware tool from the device panel", async () => {
    const service = createService();
    const controller = createSdkworkAdminController({ service });
    renderPage(controller);

    expect(
      await screen.findByText("self.audio_speaker.set_volume"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^调用$/ }));
    const args = await screen.findByLabelText("参数 JSON");
    fireEvent.change(args, { target: { value: '{"volume":30}' } });
    fireEvent.click(screen.getByRole("button", { name: /执行调用/ }));

    await waitFor(() => {
      expect(service.invokeHardwareTool).toHaveBeenCalledWith(
        "device-a",
        "self.audio_speaker.set_volume",
        { volume: 30 },
      );
    });
    expect((await screen.findAllByText(/调用完成/)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/volume accepted/)).toBeInTheDocument();
  });
});
