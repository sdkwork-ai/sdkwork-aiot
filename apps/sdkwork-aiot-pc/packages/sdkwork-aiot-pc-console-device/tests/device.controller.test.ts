import { describe, expect, it, vi } from "vitest";
import * as deviceModule from "../src";

describe("sdkwork-aiot-pc-console-device controller", () => {
  it("bootstraps device data, filters by posture, and refreshes with the active selection", async () => {
    const createDefaultSdkworkManagedDevices = (deviceModule as Record<string, any>).createDefaultSdkworkManagedDevices;
    const createEmptySdkworkDeviceCatalog = (deviceModule as Record<string, any>).createEmptySdkworkDeviceCatalog;
    const createSdkworkDeviceController = (deviceModule as Record<string, any>).createSdkworkDeviceController;

    const devices = createDefaultSdkworkManagedDevices();
    const service = {
      getCatalog: vi.fn().mockResolvedValue(
        createEmptySdkworkDeviceCatalog({
          devices,
          isAuthenticated: true,
          selectedDeviceId: "device-render-node",
        }),
      ),
      getEmptyCatalog: vi.fn().mockReturnValue(
        createEmptySdkworkDeviceCatalog({
          devices,
          isAuthenticated: false,
          selectedDeviceId: "device-field-laptop",
        }),
      ),
    };

    const controller = createSdkworkDeviceController({
      service,
    });

    expect(controller.getState().selectedDeviceId).toBe("device-field-laptop");
    expect(controller.getState().visibleDevices).toHaveLength(3);

    await controller.bootstrap();
    expect(controller.getState()).toMatchObject({
      isBootstrapped: true,
      isLoading: false,
      selectedDeviceId: "device-render-node",
    });

    controller.setHealthLevel("healthy");
    expect(controller.getState().visibleDevices.map((device: { id: string }) => device.id)).toEqual([
      "device-studio-workstation",
    ]);
    expect(controller.getState().selectedDeviceId).toBe("device-studio-workstation");

    controller.setHealthLevel("all");
    controller.setArea("storage");
    expect(controller.getState().visibleDevices.map((device: { id: string }) => device.id)).toEqual([
      "device-field-laptop",
    ]);

    controller.selectDevice("device-field-laptop");
    await controller.refresh();

    expect(service.getCatalog).toHaveBeenLastCalledWith({
      deviceId: "device-field-laptop",
      page: 1,
    });
    expect(controller.getState().selectedDeviceId).toBe("device-field-laptop");
  });
});
