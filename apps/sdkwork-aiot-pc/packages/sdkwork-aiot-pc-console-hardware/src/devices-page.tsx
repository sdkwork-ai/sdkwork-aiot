import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatHardwareConsoleCopy, resolveHardwareConsoleCopy, type HardwareConsoleCopy } from './copy.ts';
import {
  HEALTH_TONE,
  HardwarePageShell,
  Panel,
  PrimaryButton,
  RegisterDrawer,
  SecondaryButton,
  StatTile,
  type ConsoleHardwareScreen,
  type HardwarePageErrorState,
} from './hardware-console-chrome.tsx';
import {
  countHealth,
  formatTimestamp,
  matchesQuery,
  type ConsoleHardwareAgent,
  type ConsoleHardwareDevice,
  type ConsoleHardwareProduct,
} from './hardware.ts';
import {
  describeConsoleHardwareError,
  type ConsoleHardwareService,
} from './hardware-service.ts';
import { useConsoleHardwareService, useEscapeToClose } from './use-console-hardware-service.ts';

export interface SdkworkHardwareDevicesPageProps {
  /** Registers/binds devices; hosts without the IoT write grant hide those actions. */
  canManage?: boolean;
  /** Host layout hook (padding, height, grid placement). */
  className?: string;
  /** Host copy overrides (localized labels); defaults to English. */
  copy?: Partial<HardwareConsoleCopy>;
  /** Cross-page navigation to the firmware catalog. */
  onNavigate?: (screen: ConsoleHardwareScreen) => void;
  /** Test/host seam; defaults to the AIoT app-surface service. */
  service?: ConsoleHardwareService;
}

const DEVICE_PAGE_SIZE = 20;

type RegisterForm = {
  chipFamily: string;
  clientId: string;
  deviceId: string;
  displayName: string;
  productId: string;
};

const EMPTY_FORM: RegisterForm = { chipFamily: '', clientId: '', deviceId: '', displayName: '', productId: '' };

/**
 * Smart Hardware — my devices page (`/console/hardware`).
 *
 * Owns the device registry: the signed-in user's devices, registration, rename, and
 * the per-device agent binding. The firmware catalog is a separate page and this
 * page never fetches it.
 */
export function SdkworkHardwareDevicesPage({
  canManage = false,
  className,
  copy: copyOverrides,
  onNavigate,
  service,
}: SdkworkHardwareDevicesPageProps) {
  const copy = useMemo(() => resolveHardwareConsoleCopy(copyOverrides), [copyOverrides]);
  const resolvedService = useConsoleHardwareService(service);

  const [devices, setDevices] = useState<ConsoleHardwareDevice[]>([]);
  const [agents, setAgents] = useState<ConsoleHardwareAgent[]>([]);
  const [products, setProducts] = useState<ConsoleHardwareProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HardwarePageErrorState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [devicePage, setDevicePage] = useState(1);
  const [deviceTotal, setDeviceTotal] = useState(0);
  const [deviceHasMore, setDeviceHasMore] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [agentDraft, setAgentDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState<RegisterForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!resolvedService) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [devicePageResult, agentPage] = await Promise.all([
        resolvedService.listDevices({ page: 1, pageSize: DEVICE_PAGE_SIZE }),
        resolvedService.listAgents({ page: 1, pageSize: 100 }).catch(() => null),
      ]);
      setDevices(devicePageResult.items);
      setAgents(agentPage?.items ?? []);
      setDevicePage(devicePageResult.page);
      setDeviceTotal(devicePageResult.total ?? devicePageResult.items.length);
      setDeviceHasMore(devicePageResult.hasMore);
      setSelectedDeviceId((current) => current || devicePageResult.items[0]?.deviceId || '');
    } catch (cause) {
      const description = describeConsoleHardwareError(cause);
      setError({ detail: description.detail, key: description.key });
      setDevices([]);
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
      const page = await resolvedService.listDevices({ page: devicePage + 1, pageSize: DEVICE_PAGE_SIZE });
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
  }, [deviceHasMore, devicePage, deviceTotal, loadingMore, resolvedService]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  useEscapeToClose(drawerOpen, closeDrawer);

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
        matchesQuery(
          [device.deviceId, device.displayName, device.productId, device.chipFamily, device.agentName],
          query,
        ),
      ),
    [devices, query],
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
      setForm(EMPTY_FORM);
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

  const saveBinding = useCallback(async () => {
    if (!resolvedService || !selectedDevice) {
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

  return (
    <>
      <HardwarePageShell
        className={className}
        copy={copy}
        description={copy.description}
        error={error}
        loading={loading || !resolvedService}
        notice={notice}
        onNavigate={onNavigate}
        onRefresh={() => void load()}
        onRegister={canManage ? () => void openRegister() : undefined}
        screen="devices"
        title={copy.title}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={copy.statTotal} value={String(Math.max(deviceTotal, devices.length))} />
            <StatTile label={copy.statOnline} value={String(health.healthy)} tone="text-emerald-600 dark:text-emerald-400" />
            <StatTile
              label={copy.statAttention}
              value={String(health.warning + health.critical)}
              tone={health.critical > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}
            />
            <StatTile label={copy.statBound} value={String(boundCount)} tone="text-cyan-700 dark:text-cyan-400" />
          </div>

          {canManage ? null : (
            <div className="rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/40 px-4 py-2 text-xs text-sky-700 dark:text-sky-300">
              {copy.readOnlyHint}
            </div>
          )}

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.searchDevices}
            className="w-full max-w-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 shadow-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
          />

          {visibleDevices.length === 0 ? (
            <Panel>
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  {query.trim() ? copy.noMatches : copy.emptyDevices}
                </p>
                {query.trim() ? null : (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{copy.emptyDevicesHint}</p>
                )}
                {query.trim() || !canManage ? null : (
                  <PrimaryButton className="mt-4" onClick={() => void openRegister()}>
                    {copy.register}
                  </PrimaryButton>
                )}
              </div>
            </Panel>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
                {visibleDevices.map((device) => (
                  <button
                    key={device.deviceId}
                    type="button"
                    onClick={() => setSelectedDeviceId(device.deviceId)}
                    className={`flex min-w-0 flex-col gap-3 rounded-2xl border bg-white dark:bg-zinc-900 p-4 text-left shadow-sm transition ${
                      device.deviceId === selectedDeviceId
                        ? 'border-zinc-900 dark:border-zinc-100 ring-1 ring-zinc-900 dark:ring-zinc-100'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{device.displayName}</h3>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{device.deviceId}</p>
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
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span>
                        {copy.chipLabel}: {device.chipFamily || '-'}
                      </span>
                      <span>
                        {copy.lastSeen}: {formatTimestamp(device.lastSeenAt) || '-'}
                      </span>
                    </div>
                    <div className="border-t border-zinc-100 dark:border-zinc-800/70 pt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
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
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{selectedDevice.displayName}</p>
                      <p className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{selectedDevice.deviceId}</p>
                      {canManage ? (
                        <div className="mt-2 flex items-end gap-2">
                          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
                            <span>{copy.renameLabel}</span>
                            <input
                              value={nameDraft}
                              disabled={busy}
                              maxLength={120}
                              onChange={(event) => setNameDraft(event.target.value)}
                              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm font-normal text-zinc-800 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
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
                        <dt className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{copy.productColumn}</dt>
                        <dd className="mt-0.5 font-mono text-zinc-800 dark:text-zinc-200">{selectedDevice.productId || '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{copy.chipLabel}</dt>
                        <dd className="mt-0.5 font-mono text-zinc-800 dark:text-zinc-200">{selectedDevice.chipFamily || '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{copy.lastSeen}</dt>
                        <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">{formatTimestamp(selectedDevice.lastSeenAt) || '-'}</dd>
                      </div>
                    </dl>
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 px-3 py-3">
                      <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{copy.agentTitle}</p>
                      <p className="mt-0.5 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">{copy.agentDescription}</p>
                      {canManage ? (
                        <div className="mt-2 flex flex-col gap-2">
                          <select
                            value={agentDraft}
                            disabled={busy}
                            onChange={(event) => setAgentDraft(event.target.value)}
                            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
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
                        <p className="mt-2 text-[11px] text-sky-700 dark:text-sky-300">{copy.agentReadOnly}</p>
                      )}
                      {selectedDevice.agentName ? (
                        <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">
                          {formatHardwareConsoleCopy(copy.agentBound, { name: selectedDevice.agentName })}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">{copy.openDevice}</div>
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
      </HardwarePageShell>

      <RegisterDrawer
        busy={busy}
        copy={copy}
        form={form}
        formError={formError}
        onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
        onClose={closeDrawer}
        onSubmit={() => void submitRegister()}
        open={drawerOpen}
        products={products}
      />
    </>
  );
}
