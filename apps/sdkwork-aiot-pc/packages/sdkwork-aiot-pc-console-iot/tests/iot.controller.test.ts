import { describe, expect, it, vi } from "vitest";
import * as iotModule from "../src";

describe("sdkwork-aiot-pc-console-iot controller", () => {
  it("bootstraps fleet data, filters by health and kind, then refreshes with selected node", async () => {
    const createDefaultSdkworkIotNodes = (iotModule as Record<string, any>).createDefaultSdkworkIotNodes;
    const createDefaultSdkworkIotAlerts = (iotModule as Record<string, any>).createDefaultSdkworkIotAlerts;
    const createEmptySdkworkIotCatalog = (iotModule as Record<string, any>).createEmptySdkworkIotCatalog;
    const createSdkworkIotController = (iotModule as Record<string, any>).createSdkworkIotController;

    const nodes = createDefaultSdkworkIotNodes();
    const alerts = createDefaultSdkworkIotAlerts();
    const service = {
      getCatalog: vi.fn().mockResolvedValue(
        createEmptySdkworkIotCatalog({
          alerts,
          isAuthenticated: true,
          nodes,
          selectedNodeId: "node-sensor-plant-west",
        }),
      ),
      getEmptyCatalog: vi.fn().mockReturnValue(
        createEmptySdkworkIotCatalog({
          alerts,
          isAuthenticated: false,
          nodes,
          selectedNodeId: "node-gateway-plant-east",
        }),
      ),
    };

    const controller = createSdkworkIotController({
      service,
    });

    expect(controller.getState().selectedNodeId).toBe("node-gateway-plant-east");
    expect(controller.getState().visibleNodes).toHaveLength(4);

    await controller.bootstrap();
    expect(controller.getState()).toMatchObject({
      isBootstrapped: true,
      isLoading: false,
      selectedNodeId: "node-sensor-plant-west",
    });

    controller.setHealthLevel("critical");
    expect(controller.getState().visibleNodes.map((node: { id: string }) => node.id)).toEqual([
      "node-sensor-plant-west",
    ]);

    controller.setHealthLevel("all");
    controller.setKind("gateway");
    expect(controller.getState().visibleNodes.map((node: { id: string }) => node.id)).toEqual([
      "node-gateway-shanghai",
      "node-gateway-plant-east",
    ]);

    controller.selectNode("node-gateway-shanghai");
    await controller.refresh();

    expect(service.getCatalog).toHaveBeenLastCalledWith({
      nodeId: "node-gateway-shanghai",
      page: 1,
    });
    expect(controller.getState().selectedNodeId).toBe("node-gateway-shanghai");
  });
});
