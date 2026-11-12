import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  countHealth,
  formatTimestamp,
  matchesQuery,
  type ConsoleHardwareAgent,
  type ConsoleHardwareDevice,
  type ConsoleHardwareFirmware,
  type ConsoleHardwareProduct,
} from './hardware.ts';
import { describeConsoleHardwareError } from './errors.ts';
import {
  type ConsoleHardwareService,
} from './hardware-service.ts';
import {
  formatHardwareConsoleCopy,
  resolveHardwareConsoleCopy,
  type HardwareConsoleCopy,
} from './copy.ts';

export interface SdkworkHardwareConsoleProps {
  /** Registers/binds devices; hosts without the IoT write grant hide those actions. */
  canManage?: boolean;
  /** Host copy overrides (localized labels); defaults to English. */
  copy?: Partial<HardwareConsoleCopy>;
  /** Deep link target for the first paint (hosts map their route to this). */
  initialScreen?: ConsoleHardwareScreen;
  /** Test/host seam; defaults to the AIoT app-surface service. */
  service?: ConsoleHardwareService;
}

export type ConsoleHardwareScreen = 'devices' | 'firmware';

const HEALTH_TONE: Record<ConsoleHardwareDevice['health'], string> = {
  critical: 'border-rose-200 bg-rose-50 text-rose-700',
  healthy: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  offline: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
};

function Panel({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {title ? (
        <header className="border-b border-zinc-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        </header>
      ) : null}
      {children}
    </section>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? 'text-zinc-900'}`}>{value}</p>
    </div>
  );
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', children, ...rest } = props;
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', children, ...rest } = props;
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SdkworkHardwareConsole({
  canManage = false,
  copy: copyOverrides,
  initialScreen,
  service,
}: SdkworkHardwareConsoleProps) {
  const copy = useMemo(() => resolveHardwareConsoleCopy(copyOverrides), [copyOverrides]);
  const [hostService, setHostService] = useState<ConsoleHardwareService | null>(service ?? null);

  // The default service resolves the AIoT PC runtime clients. It is imported
  // lazily so an embedding host that injects its own session-bound service never
  // pulls this application's runtime into its bundle.
  useEffect(() => {
    if (service) {
      setHostService(service);
      return undefined;
    }
    let active = true;
    void import('./hardware-service-default.ts').then((module) => {
      if (active) {
        setHostService(module.getConsoleHardwareService());
      }
    });
    return () => {
      active = false;
    };
  }, [service]);

  const resolvedService = hostService;

  const [screen, setScreen] = useState<ConsoleHardwareScreen>(initialScreen ?? 'devices');
  const [devices, setDevices] = useState<ConsoleHardwareDevice[]>([]);
  const [firmware, setFirmware] = useState<ConsoleHardwareFirmware[]>([]);
  const [products, setProducts] = useState<ConsoleHardwareProduct[]>([]);
  const [agents, setAgents] = useState<ConsoleHardwareAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [devicePage, setDevicePage] = useState(1);
  const [deviceTotal, setDeviceTotal] = useState(0);
  const [deviceHasMore, setDeviceHasMore] = useState(false);
  const [firmwarePage, setFirmwarePage] = useState(1);
  const [firmwareHasMore, setFirmwareHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ detail: string; key: keyof HardwareConsoleCopy['errors'] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [deviceQuery, setDeviceQuery] = useState('');
  const [firmwareQuery, setFirmwareQuery] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [agentDraft, setAgentDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState({ chipFamily: '', clientId: '', deviceId: '', displayName: '', productId: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!resolvedService) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [devicePage, firmwarePage, agentPage] = await Promise.all([
        resolvedService.listDevices({ page: 1, pageSize: 50 }),
        resolvedService.listFirmware({ page: 1, pageSize: 100 }).catch(() => null),
        resolvedService.listAgents({ page: 1, pageSize: 100 }).catch(() => null),
      ]);
      setDevices(devicePage.items);
      setFirmware(firmwarePage?.items ?? []);
      setAgents(agentPage?.items ?? []);
      setDevicePage(devicePage.page);
      setDeviceTotal(devicePage.total ?? devicePage.items.length);
      setDeviceHasMore(devicePage.hasMore);
      setFirmwarePage(firmwarePage?.page ?? 1);
      setFirmwareHasMore(firmwarePage?.hasMore ?? false);
      setSelectedDeviceId((current) => current || devicePage.items[0]?.deviceId || '');
    } catch (cause) {
      const description = describeConsoleHardwareError(cause);
      setError({ detail: description.detail, key: description.key });
      setDevices([]);
      setFirmware([]);
    } finally {
      setLoading(false);
    }
  }, [resolvedService]);

  useEffect(() => {
    if (resolvedService) {
      void load();
    }
  }, [load, resolvedService]);

  const loadMoreDevices = useCallback(async () => {
    if (!resolvedService || !deviceHasMore || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await resolvedService.listDevices({ page: devicePage + 1 });
      setDevices((current) => {
        const seen = new Set(current.map((device) => device.deviceId));
        return [...current, ...page.items.filter((device) => !seen.has(device.deviceId))];
      });
      setDevicePage(page.page || devicePage + 1);
      setDeviceTotal(page.total ?? deviceTotal);
      setDeviceHasMore(page.hasMore);
    } catch (cause) {
      const description = describeConsoleHardwareError(cause);
      setError({ detail: description.detail, key: description.key });
    } finally {
      setLoadingMore(false);
    }
  }, [deviceHasMore, devicePage, loadingMore, resolvedService]);

  const loadMoreFirmware = useCallback(async () => {
    if (!resolvedService || !firmwareHasMore || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await resolvedService.listFirmware({ page: firmwarePage + 1 });
      setFirmware((current) => {
        const seen = new Set(current.map((artifact) => artifact.artifactId));
        return [...current, ...page.items.filter((artifact) => !seen.has(artifact.artifactId))];
      });
      setFirmwarePage(page.page || firmwarePage + 1);
      setFirmwareHasMore(page.hasMore);
    } catch (cause) {
      const description = describeConsoleHardwareError(cause);
      setError({ detail: description.detail, key: description.key });
    } finally {
      setLoadingMore(false);
    }
  }, [firmwareHasMore, firmwarePage, loadingMore, resolvedService]);

  // Escape closes the registration drawer, matching the console's dialog contract.
  useEffect(() => {
    if (!drawerOpen) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.deviceId === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );

  useEffect(() => {
    setAgentDraft(selectedDevice?.agentId ?? '');
    setNameDraft(selectedDevice?.displayName ?? '');
  }, [selectedDevice]);

  const health = useMemo(() => countHealth(devices), [devices]);
  const boundCount = useMemo(() => devices.filter((device) => device.agentId).length, [devices]);

  const visibleDevices = useMemo(
    () =>
      devices.filter((device) =>
        matchesQuery([device.deviceId, device.displayName, device.productId, device.chipFamily, device.agentName], deviceQuery),
      ),
    [deviceQuery, devices],
  );

  const visibleFirmware = useMemo(
    () =>
      firmware.filter((artifact) =>
        matchesQuery([artifact.artifactKey, artifact.version, artifact.targetChipFamily, artifact.targetRuntimeProfile], firmwareQuery),
      ),
    [firmware, firmwareQuery],
  );

  const openRegister = useCallback(async () => {
    if (!resolvedService) {
      return;
    }
    setFormError(null);
    setDrawerOpen(true);
    if (products.length > 0) {
      setForm((current) => ({ ...current, productId: current.productId || products[0]?.productId || '' }));
      return;
    }
    try {
      const page = await resolvedService.listProducts({ page: 1, pageSize: 100 });
      setProducts(page.items);
      setForm((current) => ({ ...current, productId: current.productId || page.items[0]?.productId || '' }));
    } catch (cause) {
      const description = describeConsoleHardwareError(cause);
      setError({ detail: description.detail, key: description.key });
    }
  }, [products, resolvedService]);

  const submitRegister = useCallback(async () => {
    if (!resolvedService) {
      return;
    }
    if (!form.deviceId.trim() || !form.displayName.trim() || !form.productId.trim()) {
      setFormError(copy.required);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await resolvedService.registerDevice({
        deviceId: form.deviceId.trim(),
        displayName: form.displayName.trim(),
        productId: form.productId.trim(),
        ...(form.clientId.trim() ? { clientId: form.clientId.trim() } : {}),
        ...(form.chipFamily.trim() ? { chipFamily: form.chipFamily.trim() } : {}),
      });
      setDrawerOpen(false);
      setForm((current) => ({ ...current, chipFamily: '', clientId: '', deviceId: '', displayName: '' }));
      await load();
      if (created) {
        setSelectedDeviceId(created.deviceId);
      }
    } catch (cause) {
      const description = describeConsoleHardwareError(cause);
      setError({ detail: description.detail, key: description.key });
      setDrawerOpen(false);
    } finally {
      setBusy(false);
    }
  }, [copy.required, form, load, resolvedService]);

  const renameDevice = useCallback(async () => {
    if (!resolvedService || !selectedDevice) {
      return;
    }
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === selectedDevice.displayName) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const next = await resolvedService.renameDevice(selectedDevice, trimmed);
      if (next) {
        setDevices((current) => current.map((device) => (device.deviceId === next.deviceId ? next : device)));
        setNameDraft(next.displayName);
      }
      setNotice(copy.renamed);
    } catch (cause) {
      const description = describeConsoleHardwareError(cause);
      setError({ detail: description.detail, key: description.key });
    } finally {
      setBusy(false);
    }
  }, [copy.renamed, nameDraft, resolvedService, selectedDevice]);

  const saveBinding = useCallback(async () => {    if (!resolvedService || !selectedDevice) {
      return;
    }
    const agent = agents.find((candidate) => candidate.agentId === agentDraft) ?? null;
    setBusy(true);
    setNotice(null);
    try {
      const next = await resolvedService.bindDeviceAgent(selectedDevice, agent);
      if (next) {
        setDevices((current) => current.map((device) => (device.deviceId === next.deviceId ? next : device)));
      }
      setNotice(copy.agentSaved);
    } catch (cause) {
      const description = describeConsoleHardwareError(cause);
      setError({ detail: description.detail, key: description.key });
    } finally {
      setBusy(false);
    }
  }, [agentDraft, agents, copy.agentSaved, resolvedService, selectedDevice]);

  const errorText = error ? copy.errors[error.key] : '';

  if (!resolvedService) {
    return (
      <div role="status" className="flex h-full items-center justify-center px-4 py-10 text-sm text-zinc-500">
        {copy.loading}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
      <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{copy.title}</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-500">{copy.description}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SecondaryButton onClick={() => void load()} disabled={loading}>
              {copy.refresh}
            </SecondaryButton>
            {canManage ? (
              <PrimaryButton onClick={() => void openRegister()}>
                {copy.register}
              </PrimaryButton>
            ) : null}
          </div>
        </header>

        <nav className="flex flex-wrap items-center gap-1 rounded-2xl border border-zinc-200 bg-white p-1 shadow-sm">
          {([
            ['devices', copy.tabDevices],
            ['firmware', copy.tabFirmware],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={screen === id ? 'page' : undefined}
              onClick={() => setScreen(id)}
              className={
                screen === id
                  ? 'rounded-xl bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white'
                  : 'rounded-xl px-3 py-1.5 text-xs font-semibold text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800'
              }
            >
              {label}
            </button>
          ))}
        </nav>

        {error ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <p className="font-semibold">{errorText}</p>
            {error.detail ? <p className="mt-1 text-xs leading-5">{error.detail}</p> : null}
            <SecondaryButton className="mt-3" onClick={() => void load()}>
              {copy.retry}
            </SecondaryButton>
          </div>
        ) : null}

        {notice ? (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">
            {notice}
          </div>
        ) : null}

        {loading ? (
          <div role="status" className="rounded-2xl border border-zinc-200 bg-white px-4 py-10 text-center text-sm text-zinc-500">
            {copy.loading}
          </div>
        ) : screen === 'firmware' ? (
          <div className="flex flex-col gap-3">
            <input
              value={firmwareQuery}
              onChange={(event) => setFirmwareQuery(event.target.value)}
              placeholder={copy.searchFirmware}
              className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm outline-none focus:border-zinc-400"
            />
            <Panel>
              {visibleFirmware.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm font-medium text-zinc-600">
                    {firmwareQuery.trim() ? copy.noMatches : copy.emptyFirmware}
                  </p>
                  {firmwareQuery.trim() ? null : (
                    <p className="mt-1 text-xs text-zinc-500">{copy.emptyFirmwareHint}</p>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-max border-collapse text-left">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
                        <th className="px-4 py-2.5">{copy.columnArtifact}</th>
                        <th className="px-4 py-2.5">{copy.columnVersion}</th>
                        <th className="px-4 py-2.5">{copy.columnTarget}</th>
                        <th className="px-4 py-2.5">{copy.columnChecksum}</th>
                        <th className="px-4 py-2.5">{copy.columnStatus}</th>
                        <th className="px-4 py-2.5 text-right">{copy.columnDownload}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleFirmware.map((artifact) => (
                        <tr key={artifact.artifactId} className="border-b border-zinc-100 last:border-0">
                          <td className="px-4 py-2.5 text-xs font-semibold text-zinc-800">
                            {artifact.artifactKey || artifact.fileName || artifact.artifactId}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-600">{artifact.version}</td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-600">
                            {artifact.targetChipFamily || '-'}
                            {artifact.targetRuntimeProfile ? ` · ${artifact.targetRuntimeProfile}` : ''}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-500">
                            {artifact.checksumPreview || '-'}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                              {artifact.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {artifact.downloadUrl ? (
                              <a
                                href={artifact.downloadUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-xs font-semibold text-cyan-700 hover:text-cyan-800"
                              >
                                {copy.download}
                              </a>
                            ) : (
                              <span className="text-[11px] text-zinc-400">{copy.managedOnly}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            {firmwareHasMore ? (
              <div className="flex justify-center">
                <SecondaryButton onClick={() => void loadMoreFirmware()} disabled={loadingMore}>
                  {loadingMore ? copy.loading : copy.loadMore}
                </SecondaryButton>
              </div>
            ) : null}
            <p className="text-xs text-zinc-500">{copy.firmwareHint}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatTile label={copy.statTotal} value={String(Math.max(deviceTotal, devices.length))} />
              <StatTile label={copy.statOnline} value={String(health.healthy)} tone="text-emerald-600" />
              <StatTile
                label={copy.statAttention}
                value={String(health.warning + health.critical)}
                tone={health.critical > 0 ? 'text-rose-600' : 'text-amber-600'}
              />
              <StatTile label={copy.statBound} value={String(boundCount)} tone="text-cyan-700" />
            </div>

            {canManage ? null : (
              <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-700">
                {copy.readOnlyHint}
              </div>
            )}

            <input
              value={deviceQuery}
              onChange={(event) => setDeviceQuery(event.target.value)}
              placeholder={copy.searchDevices}
              className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm outline-none focus:border-zinc-400"
            />

            {visibleDevices.length === 0 ? (
              <Panel>
                <div className="px-4 py-10 text-center">
                  <p className="text-sm font-medium text-zinc-600">
                    {deviceQuery.trim() ? copy.noMatches : copy.emptyDevices}
                  </p>
                  {deviceQuery.trim() ? null : <p className="mt-1 text-xs text-zinc-500">{copy.emptyDevicesHint}</p>}
                  {deviceQuery.trim() || !canManage ? null : (
                    <PrimaryButton className="mt-4" onClick={() => void openRegister()}>
                      {copy.register}
                    </PrimaryButton>
                  )}
                </div>
              </Panel>
            ) : (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,0.9fr)]">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {visibleDevices.map((device) => (
                    <button
                      key={device.deviceId}
                      type="button"
                      onClick={() => setSelectedDeviceId(device.deviceId)}
                      className={`flex min-w-0 flex-col gap-3 rounded-2xl border bg-white p-4 text-left shadow-sm transition ${
                        device.deviceId === selectedDeviceId
                          ? 'border-zinc-900 ring-1 ring-zinc-900'
                          : 'border-zinc-200 hover:border-zinc-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-zinc-900">{device.displayName}</h3>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{device.deviceId}</p>
                        </div>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${HEALTH_TONE[device.health]}`}>
                          {device.health === 'healthy'
                            ? copy.healthHealthy
                            : device.health === 'warning'
                              ? copy.healthWarning
                              : device.health === 'critical'
                                ? copy.healthCritical
                                : copy.healthOffline}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                        <span>
                          {copy.chipLabel}: {device.chipFamily || '-'}
                        </span>
                        <span>
                          {copy.lastSeen}: {formatTimestamp(device.lastSeenAt) || '-'}
                        </span>
                      </div>
                      <div className="border-t border-zinc-100 pt-2 text-[11px] text-zinc-500">
                        {device.agentName
                          ? formatHardwareConsoleCopy(copy.agentBound, { name: device.agentName })
                          : copy.agentEmpty}
                      </div>
                    </button>
                  ))}
                </div>

                <Panel title={copy.deviceTitle}>
                  {selectedDevice ? (
                    <div className="flex flex-col gap-4 px-5 py-4">
                      <div>
                        <p className="text-sm font-semibold text-zinc-900">{selectedDevice.displayName}</p>
                        <p className="font-mono text-[11px] text-zinc-500">{selectedDevice.deviceId}</p>
                        {canManage ? (
                          <div className="mt-2 flex items-end gap-2">
                            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] font-semibold text-zinc-600">
                              <span>{copy.renameLabel}</span>
                              <input
                                value={nameDraft}
                                disabled={busy}
                                maxLength={120}
                                onChange={(event) => setNameDraft(event.target.value)}
                                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-normal text-zinc-800 outline-none focus:border-zinc-400"
                              />
                            </label>
                            <SecondaryButton
                              onClick={() => void renameDevice()}
                              disabled={busy || !nameDraft.trim() || nameDraft.trim() === selectedDevice.displayName}
                            >
                              {copy.renameSave}
                            </SecondaryButton>
                          </div>
                        ) : null}
                      </div>
                      <dl className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{copy.productColumn}</dt>
                          <dd className="mt-0.5 font-mono text-zinc-800">{selectedDevice.productId || '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{copy.chipLabel}</dt>
                          <dd className="mt-0.5 font-mono text-zinc-800">{selectedDevice.chipFamily || '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{copy.lastSeen}</dt>
                          <dd className="mt-0.5 text-zinc-800">{formatTimestamp(selectedDevice.lastSeenAt) || '-'}</dd>
                        </div>
                      </dl>
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3">
                        <p className="text-xs font-semibold text-zinc-800">{copy.agentTitle}</p>
                        <p className="mt-0.5 text-[11px] leading-5 text-zinc-500">{copy.agentDescription}</p>
                        {canManage ? (
                          <div className="mt-2 flex flex-col gap-2">
                            <select
                              value={agentDraft}
                              disabled={busy}
                              onChange={(event) => setAgentDraft(event.target.value)}
                              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-zinc-400"
                            >
                              <option value="">{copy.agentNone}</option>
                              {agents.map((agent) => (
                                <option key={agent.agentId} value={agent.agentId}>
                                  {agent.name}
                                </option>
                              ))}
                            </select>
                            <PrimaryButton onClick={() => void saveBinding()} disabled={busy}>
                              {busy ? copy.saving : copy.agentSave}
                            </PrimaryButton>
                          </div>
                        ) : (
                          <p className="mt-2 text-[11px] text-sky-700">{copy.agentReadOnly}</p>
                        )}
                        {selectedDevice.agentName ? (
                          <p className="mt-2 text-xs text-zinc-700">
                            {formatHardwareConsoleCopy(copy.agentBound, { name: selectedDevice.agentName })}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="px-4 py-10 text-center text-sm text-zinc-500">{copy.openDevice}</div>
                  )}
                </Panel>
              </div>
            )}
            {deviceHasMore ? (
              <div className="flex justify-center">
                <SecondaryButton onClick={() => void loadMoreDevices()} disabled={loadingMore}>
                  {loadingMore ? copy.loading : copy.loadMore}
                </SecondaryButton>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/40 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" className="flex h-full w-full max-w-lg flex-col border-l border-zinc-200 bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-zinc-900">{copy.registerTitle}</h2>
                <p className="mt-0.5 text-xs leading-5 text-zinc-500">{copy.registerDescription}</p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100"
              >
                {copy.close}
              </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              {[
                { key: 'deviceId', label: copy.deviceIdLabel, hint: copy.deviceIdHint, required: true },
                { key: 'displayName', label: copy.displayNameLabel, hint: undefined, required: true },
                { key: 'clientId', label: copy.clientIdLabel, hint: undefined, required: false },
                { key: 'chipFamily', label: copy.chipLabel, hint: undefined, required: false },
              ].map((field) => (
                <label key={field.key} className="flex flex-col gap-1 text-xs font-semibold text-zinc-700">
                  <span>
                    {field.label}
                    {field.required ? <span className="ml-1 text-rose-500">*</span> : null}
                  </span>
                  <input
                    value={form[field.key as keyof typeof form]}
                    disabled={busy}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-normal text-zinc-800 outline-none focus:border-zinc-400"
                  />
                  {field.hint ? <span className="text-[11px] font-normal text-zinc-500">{field.hint}</span> : null}
                </label>
              ))}
              <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-700">
                <span>
                  {copy.productLabel}
                  <span className="ml-1 text-rose-500">*</span>
                </span>
                <select
                  value={form.productId}
                  disabled={busy || products.length === 0}
                  onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value }))}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-normal text-zinc-800 outline-none focus:border-zinc-400"
                >
                  <option value="">{copy.selectPlaceholder}</option>
                  {products.map((product) => (
                    <option key={product.productId} value={product.productId}>
                      {product.displayName} · {product.productId}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] font-normal text-zinc-500">{copy.productHint}</span>
              </label>
              {products.length === 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {copy.noProducts}
                </p>
              ) : null}
              {formError ? <p className="text-xs font-medium text-rose-600">{formError}</p> : null}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
              <SecondaryButton onClick={() => setDrawerOpen(false)} disabled={busy}>
                {copy.cancel}
              </SecondaryButton>
              <PrimaryButton onClick={() => void submitRegister()} disabled={busy}>
                {busy ? copy.saving : copy.confirm}
              </PrimaryButton>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
