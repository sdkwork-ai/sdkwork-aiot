import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SdkworkHardwareDevicesPage } from '../src/devices-page.tsx';
import { SdkworkHardwareFirmwarePage } from '../src/firmware-page.tsx';
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

describe('SdkworkHardwareDevicesPage', () => {
  it('renders only the device registry for its URL', async () => {
    render(<SdkworkHardwareDevicesPage canManage service={stubService()} />);
    await waitFor(() => expect(screen.getAllByText('Lobby lock').length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { level: 1, name: 'Smart Hardware' })).toBeInTheDocument();
    expect(screen.getByText('My devices')).toBeInTheDocument();
    // The firmware catalog belongs to the other page and must not be fetched here.
    expect(screen.queryByText('lock-fw')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register device' })).toBeInTheDocument();
  });

  it('navigates to the firmware page through the page switcher', async () => {
    const onNavigate = vi.fn();
    render(<SdkworkHardwareDevicesPage canManage onNavigate={onNavigate} service={stubService()} />);
    await waitFor(() => expect(screen.getAllByText('Lobby lock').length).toBeGreaterThan(0));
    screen.getByRole('button', { name: 'Firmware downloads' }).click();
    expect(onNavigate).toHaveBeenCalledWith('firmware');
  });

  it('hides registration when the host has no write grant', async () => {
    render(<SdkworkHardwareDevicesPage canManage={false} service={stubService()} />);
    await waitFor(() => expect(screen.getAllByText('Lobby lock').length).toBeGreaterThan(0));
    expect(screen.queryAllByRole('button', { name: 'Register device' })).toHaveLength(0);
    expect(screen.getByText(/cannot register them/i)).toBeInTheDocument();
  });

  it('ships dark-mode variants on its surfaces', async () => {
    const { container } = render(<SdkworkHardwareDevicesPage canManage service={stubService()} />);
    await waitFor(() => expect(screen.getAllByText('Lobby lock').length).toBeGreaterThan(0));
    const darkClasses = Array.from(container.querySelectorAll('[class]')).flatMap((element) =>
      Array.from(element.classList).filter((value) => value.startsWith('dark:')),
    );
    expect(new Set(darkClasses).size).toBeGreaterThan(20);
    expect(darkClasses).toContain('dark:bg-zinc-900');
    expect(darkClasses).toContain('dark:border-zinc-800');
    expect(darkClasses).toContain('dark:text-zinc-100');
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
        items: [firstDevice, { ...firstDevice, deviceId: 'dev-2', displayName: 'Hall lock' }],
        page: 2,
        pageSize: 20,
        total: 2,
      };
    });
    render(<SdkworkHardwareDevicesPage canManage={false} service={service} />);
    await waitFor(() => expect(screen.getAllByText('Lobby lock').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'Load more' }).click();
    await waitFor(() => expect(screen.getAllByText('Hall lock').length).toBeGreaterThan(0));
    expect(call).toBeGreaterThan(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });
});

describe('SdkworkHardwareFirmwarePage', () => {
  it('renders only the firmware catalog for its URL', async () => {
    const { container } = render(<SdkworkHardwareFirmwarePage service={stubService()} />);
    await waitFor(() => expect(screen.getByText('Firmware downloads')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Firmware downloads' })).toBeInTheDocument();
    expect(container.querySelector('a[href="https://example.test/fw.bin"]')).not.toBeNull();
    // The device registry belongs to the other page.
    expect(screen.queryByText('My devices')).not.toBeInTheDocument();
    expect(screen.queryByText('Lobby lock')).not.toBeInTheDocument();
  });

  it('navigates back to the device registry', async () => {
    const onNavigate = vi.fn();
    render(<SdkworkHardwareFirmwarePage onNavigate={onNavigate} service={stubService()} />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Firmware downloads' })).toBeInTheDocument());
    screen.getByRole('button', { name: 'My hardware' }).click();
    expect(onNavigate).toHaveBeenCalledWith('devices');
  });
});
