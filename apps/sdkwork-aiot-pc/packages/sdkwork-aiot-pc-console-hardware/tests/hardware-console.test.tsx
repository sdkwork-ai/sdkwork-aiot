import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SdkworkHardwareConsole } from '../src/hardware-console.tsx';
import type { ConsoleHardwareService } from '../src/hardware-service.ts';

function stubService(): ConsoleHardwareService {
  const emptyPage = async () => ({ hasMore: false, items: [], page: 1, pageSize: 20 });
  return {
    bindDeviceAgent: vi.fn(async () => null),
    listAgents: emptyPage,
    listDevices: vi.fn(async () => ({
      hasMore: false,
      items: [
        {
          agentId: '',
          agentName: '',
          chipFamily: 'esp32',
          clientId: '',
          deviceId: 'dev-1',
          displayName: 'Lobby lock',
          health: 'healthy' as const,
          lastSeenAt: '2026-02-03T04:05:06Z',
          metadata: {},
          productId: '1008',
          status: 'online',
        },
      ],
      page: 1,
      pageSize: 20,
    })),
    listFirmware: vi.fn(async () => ({
      hasMore: false,
      items: [
        {
          artifactId: 'art-1',
          artifactKey: 'lock-fw',
          checksumPreview: '0123456789abcdef',
          downloadUrl: 'https://example.test/fw.bin',
          fileName: 'fw.bin',
          signature: '',
          status: 'published',
          targetChipFamily: 'esp32',
          targetRuntimeProfile: 'default',
          version: '1.2.0',
        },
      ],
      page: 1,
      pageSize: 20,
    })),
    listProducts: emptyPage,
    registerDevice: vi.fn(async () => null),
    renameDevice: vi.fn(async () => null),
    retrieveDevice: vi.fn(async () => null),
  };
}

describe('SdkworkHardwareConsole', () => {
  it('renders the user devices with the bound-agent state', async () => {
    render(<SdkworkHardwareConsole canManage service={stubService()} />);
    await waitFor(() => expect(screen.getAllByText('Lobby lock').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'My hardware' })).toBeInTheDocument();
    expect(screen.getAllByText('No agent bound').length).toBeGreaterThan(0);
  });

  it('hides registration when the host has no write grant', async () => {
    render(<SdkworkHardwareConsole canManage={false} service={stubService()} />);
    await waitFor(() => expect(screen.getAllByText('Lobby lock').length).toBeGreaterThan(0));
    expect(screen.queryAllByRole('button', { name: 'Register device' })).toHaveLength(0);
    expect(screen.getByText(/cannot register them/i)).toBeInTheDocument();
  });

  it('renders the firmware catalog with a direct download link', async () => {
    const { container } = render(<SdkworkHardwareConsole canManage={false} service={stubService()} />);
    await waitFor(() => expect(screen.getAllByText('Lobby lock').length).toBeGreaterThan(0));
    screen.getAllByRole('button', { name: 'Firmware downloads' })[0]?.click();
    await waitFor(() => expect(screen.getByText('lock-fw')).toBeInTheDocument());
    expect(container.querySelector('a[href="https://example.test/fw.bin"]')).not.toBeNull();
  });

  it('loads the next device page and de-duplicates the appended rows', async () => {
    const service = stubService();
    const firstPage = await service.listDevices({ page: 1 });
    const firstDevice = firstPage.items[0]!;
    let call = 0;
    service.listDevices = vi.fn(async ({ page = 1 } = {}) => {
      call += 1;
      if (page === 1) {
        return { hasMore: true, items: [firstDevice], page: 1, pageSize: 20, total: 2 };
      }
      return {
        hasMore: false,
        items: [
          // The same device is returned again to prove the append de-duplicates.
          firstDevice,
          { ...firstDevice, deviceId: 'dev-2', displayName: 'Hall lock' },
        ],
        page: 2,
        pageSize: 20,
        total: 2,
      };
    });
    render(<SdkworkHardwareConsole canManage={false} service={service} />);
    await waitFor(() => expect(screen.getAllByText('Lobby lock').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'Load more' }).click();
    await waitFor(() => expect(screen.getAllByText('Hall lock').length).toBeGreaterThan(0));
    expect(call).toBeGreaterThan(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});
