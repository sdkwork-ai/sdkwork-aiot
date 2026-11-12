import { describe, expect, it, vi } from 'vitest';

import {
  countHealth,
  firmwareDownloadUrl,
  mapDevice,
  mapFirmware,
  mapPage,
  mapProduct,
  withAgentBinding,
  DEVICE_AGENT_ID_KEY,
  DEVICE_AGENT_NAME_KEY,
} from '../src/hardware.ts';
import { createConsoleHardwareService } from '../src/hardware-service.ts';

function createStubClient() {
  const listDevices = vi.fn(async () => ({
    items: [
      {
        deviceId: 'dev-1',
        displayName: 'Lobby lock',
        productId: '1008',
        status: 'online',
        metadata: { agentId: 'agent-1', agentName: 'Concierge' },
      },
    ],
    pageInfo: { page: 1, pageSize: 20, total: 1, hasMore: false },
  }));
  const retrieveDevice = vi.fn(async (deviceId: string) => ({
    deviceId,
    displayName: 'Lobby lock',
    productId: '1008',
    status: 'online',
  }));
  const createDevice = vi.fn(async (body: Record<string, unknown>) => ({
    deviceId: body.deviceId,
    displayName: body.displayName,
    productId: body.productId,
    status: 'online',
  }));
  const updateDevice = vi.fn(async (deviceId: string, body: { metadata?: Record<string, unknown> }) => ({
    deviceId,
    displayName: 'Lobby lock',
    productId: '1008',
    status: 'online',
    metadata: body.metadata ?? {},
  }));
  const listProducts = vi.fn(async () => ({
    items: [{ productId: '1008', displayName: 'Smart lock' }],
    pageInfo: { page: 1, pageSize: 20, total: 1, hasMore: false },
  }));
  const listFirmware = vi.fn(async () => ({
    items: [
      {
        artifactId: 'art-1',
        artifactKey: 'lock-fw',
        version: '1.2.0',
        sha256: '0123456789abcdef',
        status: 'published',
        resource: { url: 'https://example.test/fw.bin' },
      },
    ],
    pageInfo: { page: 1, pageSize: 20, total: 1, hasMore: false },
  }));

  return {
    client: {
      iot: {
        devices: {
          list: listDevices,
          retrieve: retrieveDevice,
          create: createDevice,
          update: updateDevice,
        },
        products: { list: listProducts },
        firmwareArtifacts: { list: listFirmware },
      },
    },
    createDevice,
    listDevices,
    updateDevice,
  };
}

describe('smart hardware mappers', () => {
  it('maps the device and resolves the agent binding from metadata', () => {
    const device = mapDevice({
      deviceId: 'dev-1',
      displayName: 'Lobby',
      status: 'online',
      metadata: { [DEVICE_AGENT_ID_KEY]: 'agent-1', [DEVICE_AGENT_NAME_KEY]: 'Concierge' },
    });
    expect(device).toMatchObject({ agentId: 'agent-1', agentName: 'Concierge', health: 'healthy' });
  });

  it('drops rows without an identifier and keeps page info', () => {
    const page = mapPage(
      {
        items: [{ deviceId: 'a' }, { displayName: 'invalid' }],
        pageInfo: { page: 1, pageSize: 20, total: 5, hasMore: true },
      },
      mapDevice,
    );
    expect(page.items.map((item) => item.deviceId)).toEqual(['a']);
    expect(page).toMatchObject({ hasMore: true, total: 5 });
  });

  it('maps products and firmware download metadata', () => {
    expect(mapProduct({ productId: '1008' })).toMatchObject({ productId: '1008' });
    const firmware = mapFirmware({
      artifactId: 'art-1',
      artifactKey: 'lock-fw',
      version: '1.2.0',
      sha256: '0123456789abcdef',
      resource: { url: 'https://example.test/fw.bin' },
    });
    expect(firmware?.downloadUrl).toBe('https://example.test/fw.bin');
    expect(firmware?.checksumPreview).toBe('0123456789abcdef');
    expect(firmwareDownloadUrl({ objectBlobId: 'blob-1' })).toBe('');
  });

  it('binds and clears the agent binding without touching other metadata', () => {
    const bound = withAgentBinding({ room: 'lobby' }, { agentId: 'agent-1', name: 'Concierge' });
    expect(bound).toEqual({ room: 'lobby', agentId: 'agent-1', agentName: 'Concierge' });
    expect(withAgentBinding(bound, null)).toEqual({ room: 'lobby' });
  });

  it('counts device health for the console statistics', () => {
    const counts = countHealth([
      { agentId: '', agentName: '', chipFamily: '', clientId: '', deviceId: 'a', displayName: 'a', health: 'healthy', lastSeenAt: '', metadata: {}, productId: '', status: 'online' },
      { agentId: '', agentName: '', chipFamily: '', clientId: '', deviceId: 'b', displayName: 'b', health: 'warning', lastSeenAt: '', metadata: {}, productId: '', status: 'degraded' },
    ]);
    expect(counts).toEqual({ critical: 0, healthy: 1, offline: 0, warning: 1 });
  });
});

describe('smart hardware app-surface service', () => {
  it('lists the signed-in user devices through the app surface', async () => {
    const stub = createStubClient();
    const service = createConsoleHardwareService({ resolveClient: () => stub.client as never });
    const page = await service.listDevices({ page: 1, pageSize: 20 });
    expect(stub.listDevices).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(page.items[0]).toMatchObject({ agentName: 'Concierge' });
  });

  it('registers a device with an idempotency key', async () => {
    const stub = createStubClient();
    const service = createConsoleHardwareService({ resolveClient: () => stub.client as never });
    await service.registerDevice({ deviceId: 'dev-2', displayName: 'Hall', productId: '1008' });
    const [body, params] = stub.createDevice.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { idempotencyKey: string },
    ];
    expect(body).toMatchObject({ deviceId: 'dev-2', productId: '1008' });
    expect(params.idempotencyKey).toMatch(/^iot-console-device-create-/);
  });

  it('persists the agent binding through the device metadata update', async () => {    const stub = createStubClient();
    const service = createConsoleHardwareService({ resolveClient: () => stub.client as never });
    const next = await service.bindDeviceAgent(
      {
        agentId: '',
        agentName: '',
        chipFamily: '',
        clientId: '',
        deviceId: 'dev-1',
        displayName: 'Lobby',
        health: 'healthy',
        lastSeenAt: '',
        metadata: { room: 'lobby' },
        productId: '1008',
        status: 'online',
      },
      { agentId: 'agent-1', name: 'Concierge' },
    );
    const [deviceId, body] = stub.updateDevice.mock.calls[0] as unknown as [
      string,
      { metadata: Record<string, unknown> },
    ];
    expect(deviceId).toBe('dev-1');
    expect(body.metadata).toEqual({ room: 'lobby', agentId: 'agent-1', agentName: 'Concierge' });
    expect(next?.agentName).toBe('Concierge');
  });

  it('renames an owned device and rejects a blank name', async () => {
    const stub = createStubClient();
    const service = createConsoleHardwareService({ resolveClient: () => stub.client as never });
    const device = {
      agentId: '',
      agentName: '',
      chipFamily: '',
      clientId: '',
      deviceId: 'dev-1',
      displayName: 'Lobby',
      health: 'healthy' as const,
      lastSeenAt: '',
      metadata: {},
      productId: '1008',
      status: 'online',
    };
    await service.renameDevice(device, '  Lobby lock  ');
    const [deviceId, body] = stub.updateDevice.mock.calls[0] as unknown as [
      string,
      { displayName?: string; metadata?: Record<string, unknown> },
    ];
    expect(deviceId).toBe('dev-1');
    expect(body.displayName).toBe('Lobby lock');
    const failure = await service.renameDevice(device, '   ').then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('must not be empty');
  });

  it('lists products and firmware through the app surface', async () => {
    const stub = createStubClient();
    const service = createConsoleHardwareService({ resolveClient: () => stub.client as never });
    expect((await service.listProducts()).items[0]?.productId).toBe('1008');
    expect((await service.listFirmware()).items[0]?.artifactId).toBe('art-1');
  });
});
