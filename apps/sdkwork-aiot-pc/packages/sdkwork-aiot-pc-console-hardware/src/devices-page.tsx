import { useCallback, useEffect, useMemo, useState } from 'react';

import { formatHardwareConsoleCopy, resolveHardwareConsoleCopy, type HardwareConsoleCopy } from './copy.ts';
import {
  HEALTH_TONE,
  EMPTY_REGISTER_AGENT_DRAFT,
  HardwarePageShell,
  Panel,
  PrimaryButton,
  RegisterDrawer,
  SecondaryButton,
  StatTile,
  type ConsoleHardwareScreen,
  type HardwarePageErrorState,
  type RegisterAgentDraft,
} from './hardware-console-chrome.tsx';
import {
  countHealth,
  formatLastSeen,
  matchesQuery,
  type ConsoleHardwareAgent,
  type ConsoleHardwareDevice,
  type ConsoleHardwareProduct,
} from './hardware.ts';
import {
  describeConsoleHardwareError,
  type ConsoleHardwareError,
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

/** Select value that switches the agent picker into inline creation. */
const AGENT_CREATE_OPTION = '__create__';

/**
 * Builds the inline form failure text. Field-level validation details returned by
 * the service are actionable, so they are appended; internals of a 5xx or a
 * transport failure stay out of the UI.
 */
function describeFailure(copy: HardwareConsoleCopy, description: ConsoleHardwareError): string {
  const base = copy.errors[description.key] || copy.errors.unavailable;
  if (description.status === 400 || description.status === 409 || description.status === 422) {
    const detail = description.detail.trim();
    return detail && detail !== base ? `${base} ${detail}` : base;
  }
  return base;
}

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
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  const [productsLoading, setProductsLoading] = useState(false);
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
  const [agentNewName, setAgentNewName] = useState('');
  const [nameDraft, setNameDraft] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState<RegisterForm>(EMPTY_FORM);
  const [registerAgentDraft, setRegisterAgentDraft] = useState<RegisterAgentDraft>(EMPTY_REGISTER_AGENT_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const canCreateAgent = Boolean(resolvedService?.createAgent);

  const load = useCallback(async () => {
    if (!resolvedService) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [devicePageResult, agentPage, productPage] = await Promise.all([
        resolvedService.listDevices({ page: 1, pageSize: DEVICE_PAGE_SIZE }),
        resolvedService.listAgents({ page: 1, pageSize: 100 }).catch(() => null),
        // The registration catalog is optional for this page: it resolves the
        // product display names and warms the drawer. Read-only visitors never
        // open the drawer, so they do not spend a catalog request (and a
        // possible permission denial) just to render the list.
        canManage
          ? resolvedService.listProducts({ page: 1, pageSize: 100 }).catch(() => null)
          : Promise.resolve(null),
      ]);
      setDevices(devicePageResult.items);
      setAgents(agentPage?.items ?? []);
      if (productPage) {
        setProducts(productPage.items);
        setProductNames(
          Object.fromEntries(productPage.items.map((product) => [product.productId, product.displayName])),
        );
      }
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
  }, [canManage, resolvedService]);

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

  const closeDrawer = useCallback(() => {
    // The overlay stays open while the registration request is in flight so a
    // half-submitted form cannot be dismissed by Escape or a stray backdrop click.
    if (!busy) {
      setDrawerOpen(false);
    }
  }, [busy]);
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
    setWarning(null);
    setNotice(null);
    setRegisterAgentDraft(EMPTY_REGISTER_AGENT_DRAFT);
    setDrawerOpen(true);
    if (products.length > 0) {
      setForm((current) => ({ ...current, productId: current.productId || products[0]?.productId || '' }));
      return;
    }
    setProductsLoading(true);
    try {
      const page = await resolvedService.listProducts({ page: 1, pageSize: 100 });
      setProducts(page.items);
      setProductNames((current) => ({
        ...current,
        ...Object.fromEntries(page.items.map((product) => [product.productId, product.displayName])),
      }));
      setForm((current) => ({ ...current, productId: current.productId || page.items[0]?.productId || '' }));
    } catch (cause) {
      // Keep the drawer open: the operator is in the middle of a form, and the
      // catalog failure (permission, transport) has to be actionable in place.
      const description = describeConsoleHardwareError(cause);
      setFormError(describeFailure(copy, description));
    } finally {
      setProductsLoading(false);
    }
  }, [copy, products, resolvedService]);

  const updateRegisterAgentDraft = useCallback(
    (patch: Partial<RegisterAgentDraft>) => {
      setRegisterAgentDraft((current) => {
        const next = { ...current, ...patch };
        // Picking "bind existing" with an empty selection defaults to the first
        // agent instead of leaving the form in a state that cannot submit.
        if (next.mode === 'existing' && !next.agentId) {
          next.agentId = agents[0]?.agentId ?? '';
        }
        return next;
      });
    },
    [agents],
  );

  const resolveRegistrationAgent = useCallback(
    async (device: ConsoleHardwareDevice): Promise<ConsoleHardwareAgent | null> => {
      if (registerAgentDraft.mode === 'existing') {
        return (
          agents.find((candidate) => candidate.agentId === registerAgentDraft.agentId) ?? {
            agentId: registerAgentDraft.agentId,
            description: '',
            name: registerAgentDraft.agentId,
          }
        );
      }
      if (registerAgentDraft.mode === 'new' && resolvedService?.createAgent) {
        const defaultName = formatHardwareConsoleCopy(copy.agentDefaultName, {
          name: device.displayName || device.deviceId,
        });
        return resolvedService.createAgent({ name: registerAgentDraft.agentName.trim() || defaultName });
      }
      return null;
    },
    [agents, copy.agentDefaultName, registerAgentDraft, resolvedService],
  );

  const submitRegister = useCallback(async () => {
    if (!resolvedService) {
      return;
    }
    if (!form.deviceId.trim() || !form.displayName.trim() || !form.productId.trim()) {
      setFormError(copy.required);
      return;
    }
    if (registerAgentDraft.mode === 'existing' && !registerAgentDraft.agentId) {
      setFormError(copy.agentRequired);
      return;
    }
    if (registerAgentDraft.mode === 'new' && !resolvedService.createAgent) {
      setFormError(copy.errors.unavailable);
      return;
    }
    setBusy(true);
    setFormError(null);
    setWarning(null);
    let created: ConsoleHardwareDevice | null = null;
    try {
      created = await resolvedService.registerDevice({
        deviceId: form.deviceId.trim(),
        displayName: form.displayName.trim(),
        productId: form.productId.trim(),
        ...(form.clientId.trim() ? { clientId: form.clientId.trim() } : {}),
        ...(form.chipFamily.trim() ? { chipFamily: form.chipFamily.trim() } : {}),
      });
      if (created) {
        const agent = await resolveRegistrationAgent(created);
        if (agent) {
          const bound = await resolvedService.bindDeviceAgent(created, agent);
          if (bound) {
            created = bound;
          }
        }
      }
      setDrawerOpen(false);
      setForm(EMPTY_FORM);
      setRegisterAgentDraft(EMPTY_REGISTER_AGENT_DRAFT);
      await load();
      setNotice(copy.registered);
      if (created) {
        setSelectedDeviceId(created.deviceId);
      }
    } catch (cause) {
      if (created) {
        // The device was registered; only the agent step failed. Keep the device,
        // close the drawer, and point the operator at the device panel.
        setDrawerOpen(false);
        setForm(EMPTY_FORM);
        setRegisterAgentDraft(EMPTY_REGISTER_AGENT_DRAFT);
        await load().catch(() => undefined);
        setSelectedDeviceId(created.deviceId);
        setWarning(copy.agentPartialFailure);
      } else {
        // Preserve the operator's input: a failed registration is a form-level
        // error, not a reason to throw the drawer away.
        const description = describeConsoleHardwareError(cause);
        setFormError(describeFailure(copy, description));
      }
    } finally {
      setBusy(false);
    }
  }, [copy, form, load, registerAgentDraft, resolveRegistrationAgent, resolvedService]);

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
    const createMode = agentDraft === AGENT_CREATE_OPTION;
    if (createMode && !resolvedService.createAgent) {
      return;
    }
    setBusy(true);
    setNotice(null);
    setWarning(null);
    try {
      let agent: ConsoleHardwareAgent | null = null;
      if (createMode) {
        const defaultName = formatHardwareConsoleCopy(copy.agentDefaultName, {
          name: selectedDevice.displayName || selectedDevice.deviceId,
        });
        const createdAgent = await resolvedService.createAgent?.({
          name: agentNewName.trim() || defaultName,
        });
        if (!createdAgent) {
          setError({ detail: '', key: 'unavailable' });
          return;
        }
        agent = createdAgent;
      } else {
        agent = agents.find((candidate) => candidate.agentId === agentDraft) ?? null;
      }
      const next = await resolvedService.bindDeviceAgent(selectedDevice, agent);
      if (next) {
        setDevices((current) => current.map((device) => (device.deviceId === next.deviceId ? next : device)));
        setAgentDraft(next.agentId);
        setAgentNewName('');
      }
      await load();
      setNotice(copy.agentSaved);
    } catch (cause) {
      const description = describeConsoleHardwareError(cause);
      setError({ detail: description.detail, key: description.key });
    } finally {
      setBusy(false);
    }
  }, [agentDraft, agentNewName, agents, copy, load, resolvedService, selectedDevice]);

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
        warning={warning}
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
            aria-label={copy.searchDevices}
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
                        <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {device.displayName}
                        </span>
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
                        {copy.productColumn}: {productNames[device.productId] || device.productId || '-'}
                      </span>
                      <span>
                        {copy.chipLabel}: {device.chipFamily || '-'}
                      </span>
                      <span>
                        {copy.lastSeen}:{' '}
                        {formatLastSeen(device.lastSeenAt, { justNow: copy.justNow }) || copy.neverConnected}
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
                        <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                          {productNames[selectedDevice.productId] || selectedDevice.productId || '-'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{copy.chipLabel}</dt>
                        <dd className="mt-0.5 font-mono text-zinc-800 dark:text-zinc-200">{selectedDevice.chipFamily || '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{copy.lastSeen}</dt>
                        <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                          {formatLastSeen(selectedDevice.lastSeenAt, { justNow: copy.justNow }) || copy.neverConnected}
                        </dd>
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
                            aria-label={copy.agentSelect}
                            onChange={(event) => {
                              setAgentDraft(event.target.value);
                              setAgentNewName('');
                            }}
                            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                          >
                            <option value="">{copy.agentNone}</option>
                            {agents.map((agent) => (
                              <option key={agent.agentId} value={agent.agentId}>
                                {agent.name}
                              </option>
                            ))}
                            {canCreateAgent ? <option value={AGENT_CREATE_OPTION}>{copy.agentCreateOption}</option> : null}
                          </select>
                          {agentDraft === AGENT_CREATE_OPTION ? (
                            <>
                              <input
                                value={agentNewName}
                                disabled={busy}
                                maxLength={80}
                                autoComplete="off"
                                aria-label={copy.agentNameLabel}
                                placeholder={copy.agentNamePlaceholder}
                                onChange={(event) => setAgentNewName(event.target.value)}
                                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                              />
                              <span className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                                {copy.agentCreateHint}
                              </span>
                            </>
                          ) : null}
                          <PrimaryButton
                            onClick={() => void saveBinding()}
                            disabled={busy || (agentDraft === AGENT_CREATE_OPTION && !canCreateAgent)}
                          >
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
        agentDraft={registerAgentDraft}
        agents={agents}
        busy={busy}
        canCreateAgent={canCreateAgent}
        copy={copy}
        form={form}
        formError={formError}
        onAgentDraftChange={updateRegisterAgentDraft}
        onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
        onClose={closeDrawer}
        onSubmit={() => void submitRegister()}
        open={drawerOpen}
        products={products}
        productsLoading={productsLoading}
      />
    </>
  );
}
