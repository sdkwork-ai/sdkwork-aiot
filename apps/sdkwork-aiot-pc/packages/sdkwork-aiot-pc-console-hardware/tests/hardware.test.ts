import { describe, expect, it, vi } from 'vitest';

import {
  countHealth,
  DEVICE_AGENT_ID_KEY,
  DEVICE_AGENT_NAME_KEY,
  NEVER_CONNECTED_TIMESTAMP,
  firmwareDownloadUrl,
  formatLastSeen,
  formatTimestamp,
  isNeverConnected,
  mapDevice,
  mapFirmware,
  mapPage,
  mapProduct,
  parseTimestamp,
  resolveDeviceHealth,
  withAgentBinding,
} from '../src/hardware.ts';
import { createConsoleHardwareService, describeConsoleHardwareError } from '../src/hardware-service.ts';

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
      lastSeenAt: new Date().toISOString(),
      status: 'online',
      metadata: { [DEVICE_AGENT_ID_KEY]: 'agent-1', [DEVICE_AGENT_NAME_KEY]: 'Concierge' },
    });
    expect(device).toMatchObject({ agentId: 'agent-1', agentName: 'Concierge', health: 'healthy' });
  });

  it('maps a device without a real contact sample as offline', () => {
    expect(mapDevice({ deviceId: 'never-seen', status: 'active' })?.health).toBe('offline');
    expect(mapDevice({ deviceId: 'placeholder', lastSeenAt: NEVER_CONNECTED_TIMESTAMP, status: 'active' })?.health).toBe(
      'offline',
    );
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

describe('smart hardware timestamps and health', () => {
  it('reads a zone-less wire timestamp as UTC', () => {
    expect(parseTimestamp('2026-11-15T16:00:00')?.toISOString()).toBe('2026-11-15T16:00:00.000Z');
    expect(parseTimestamp('2026-11-15T16:00:00Z')?.toISOString()).toBe('2026-11-15T16:00:00.000Z');
    expect(parseTimestamp('not a date')).toBeNull();
  });

  it('treats the storage never-seen placeholder as no contact sample', () => {
    expect(isNeverConnected('')).toBe(true);
    expect(isNeverConnected(NEVER_CONNECTED_TIMESTAMP)).toBe(true);
    expect(formatTimestamp(NEVER_CONNECTED_TIMESTAMP)).toBe('');
    expect(formatLastSeen(NEVER_CONNECTED_TIMESTAMP)).toBe('');
  });

  it('renders a fresh contact as just now and an older one relatively', () => {
    const now = Date.UTC(2026, 10, 15, 16, 10, 0);
    expect(formatLastSeen(new Date(now - 30_000).toISOString(), { justNow: 'just now', now })).toBe('just now');
    const fiveMinutes = formatLastSeen(new Date(now - 5 * 60_000).toISOString(), { locale: 'en', now });
    expect(fiveMinutes).toContain('5');
    expect(fiveMinutes).toContain('minute');
  });

  it('derives online health from contact freshness instead of the lifecycle status', () => {
    const now = Date.UTC(2026, 10, 15, 16, 10, 0);
    const fresh = new Date(now - 60_000).toISOString();
    const stale = new Date(now - 60 * 60_000).toISOString();
    expect(resolveDeviceHealth('active', fresh, now)).toBe('healthy');
    expect(resolveDeviceHealth('active', stale, now)).toBe('offline');
    expect(resolveDeviceHealth('online', NEVER_CONNECTED_TIMESTAMP, now)).toBe('offline');
    expect(resolveDeviceHealth('critical', fresh, now)).toBe('critical');
    expect(resolveDeviceHealth('degraded', fresh, now)).toBe('warning');
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

  it('persists the agent binding through the device metadata update', async () => {
    const stub = createStubClient();
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

  it('exposes agent creation only when the host provides the seam', () => {
    const stub = createStubClient();
    const withoutCreator = createConsoleHardwareService({ resolveClient: () => stub.client as never });
    expect(withoutCreator.createAgent).toBeUndefined();

    const createAgent = async ({ name }: { name: string }) => ({
      agentId: 'agent-9',
      description: '',
      name,
    });
    const withCreator = createConsoleHardwareService({
      resolveClient: () => stub.client as never,
      createAgent,
    });
    expect(withCreator.createAgent).toBe(createAgent);
  });
});

describe('console hardware error classification', () => {
  it('prefers the problem detail and classifies by HTTP status', () => {
    expect(
      describeConsoleHardwareError({ problem: { detail: 'Permission denied: iot.profiles.read', status: 403 } }),
    ).toEqual({ detail: 'Permission denied: iot.profiles.read', key: 'forbidden', status: 403 });
    expect(describeConsoleHardwareError(Object.assign(new Error('device already exists'), { status: 409 }))).toMatchObject({
      key: 'conflict',
      status: 409,
    });
    expect(describeConsoleHardwareError(Object.assign(new Error('bad input'), { status: 400 })).key).toBe('validation');
    expect(describeConsoleHardwareError({ status: 422 }).key).toBe('validation');
  });

  it('treats transport failures and rate limits as retryable unavailability', () => {
    expect(describeConsoleHardwareError(new Error('Failed to fetch'))).toMatchObject({
      key: 'unavailable',
      detail: 'Failed to fetch',
    });
    expect(describeConsoleHardwareError({ status: 429 }).key).toBe('unavailable');
    expect(describeConsoleHardwareError({ status: 503 }).key).toBe('unavailable');
  });
});
