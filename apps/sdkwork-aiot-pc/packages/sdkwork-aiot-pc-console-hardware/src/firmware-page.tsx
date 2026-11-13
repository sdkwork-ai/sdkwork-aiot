import { useCallback, useEffect, useMemo, useState } from 'react';

import { resolveHardwareConsoleCopy, type HardwareConsoleCopy } from './copy.ts';
import {
  HardwarePageShell,
  Panel,
  SecondaryButton,
  type ConsoleHardwareScreen,
  type HardwarePageErrorState,
} from './hardware-console-chrome.tsx';
import { matchesQuery, type ConsoleHardwareFirmware } from './hardware.ts';
import {
  describeConsoleHardwareError,
  type ConsoleHardwareService,
} from './hardware-service.ts';
import { useConsoleHardwareService } from './use-console-hardware-service.ts';

export interface SdkworkHardwareFirmwarePageProps {
  /** Host layout hook (padding, height, grid placement). */
  className?: string;
  /** Host copy overrides (localized labels); defaults to English. */
  copy?: Partial<HardwareConsoleCopy>;
  /** Cross-page navigation back to the device registry. */
  onNavigate?: (screen: ConsoleHardwareScreen) => void;
  /** Test/host seam; defaults to the AIoT app-surface service. */
  service?: ConsoleHardwareService;
}

const FIRMWARE_PAGE_SIZE = 50;

/**
 * Smart Hardware — firmware downloads page (`/console/hardware/firmware`).
 *
 * Owns the published firmware catalog and its direct downloads. It is a separate
 * route and a separate page: it never loads the user's devices or the agent
 * catalog, and the device registry page never loads firmware.
 */
export function SdkworkHardwareFirmwarePage({
  className,
  copy: copyOverrides,
  onNavigate,
  service,
}: SdkworkHardwareFirmwarePageProps) {
  const copy = useMemo(() => resolveHardwareConsoleCopy(copyOverrides), [copyOverrides]);
  const resolvedService = useConsoleHardwareService(service);

  const [firmware, setFirmware] = useState<ConsoleHardwareFirmware[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<HardwarePageErrorState | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    if (!resolvedService) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await resolvedService.listFirmware({ page: 1, pageSize: FIRMWARE_PAGE_SIZE });
      setFirmware(result.items);
      setPage(result.page);
      setHasMore(result.hasMore);
    } catch (cause) {
      const description = describeConsoleHardwareError(cause);
      setError({ detail: description.detail, key: description.key });
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

  const loadMoreFirmware = useCallback(async () => {
    if (!resolvedService || !hasMore || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const result = await resolvedService.listFirmware({ page: page + 1, pageSize: FIRMWARE_PAGE_SIZE });
      setFirmware((current) => {
        const seen = new Set(current.map((artifact) => artifact.artifactId));
        return [...current, ...result.items.filter((artifact) => !seen.has(artifact.artifactId))];
      });
      setPage(result.page || page + 1);
      setHasMore(result.hasMore);
    } catch (cause) {
      const description = describeConsoleHardwareError(cause);
      setError({ detail: description.detail, key: description.key });
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, page, resolvedService]);

  const visibleFirmware = useMemo(
    () =>
      firmware.filter((artifact) =>
        matchesQuery(
          [artifact.artifactKey, artifact.version, artifact.targetChipFamily, artifact.targetRuntimeProfile],
          query,
        ),
      ),
    [firmware, query],
  );

  return (
    <HardwarePageShell
      className={className}
      copy={copy}
      description={copy.firmwareDescription}
      error={error}
      loading={loading || !resolvedService}
      notice={null}
      onNavigate={onNavigate}
      onRefresh={() => void load()}
      screen="firmware"
      title={copy.firmwareTitle}
    >
      <div className="flex flex-col gap-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.searchFirmware}
          className="w-full max-w-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 shadow-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
        />
        <Panel>
          {visibleFirmware.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                {query.trim() ? copy.noMatches : copy.emptyFirmware}
              </p>
              {query.trim() ? null : (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{copy.emptyFirmwareHint}</p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-max border-collapse text-left">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
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
                    <tr key={artifact.artifactId} className="border-b border-zinc-100 dark:border-zinc-800/70 last:border-0">
                      <td className="px-4 py-2.5 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                        {artifact.artifactKey || artifact.fileName || artifact.artifactId}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">{artifact.version}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                        {artifact.targetChipFamily || '-'}
                        {artifact.targetRuntimeProfile ? ` · ${artifact.targetRuntimeProfile}` : ''}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                        {artifact.checksumPreview || '-'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                          {artifact.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {artifact.downloadUrl ? (
                          <a
                            href={artifact.downloadUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-xs font-semibold text-cyan-700 dark:text-cyan-400 hover:text-cyan-800 dark:hover:text-cyan-300"
                          >
                            {copy.download}
                          </a>
                        ) : (
                          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{copy.managedOnly}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        {hasMore ? (
          <div className="flex justify-center">
            <SecondaryButton onClick={() => void loadMoreFirmware()} disabled={loadingMore}>
              {loadingMore ? copy.loading : copy.loadMore}
            </SecondaryButton>
          </div>
        ) : null}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{copy.firmwareHint}</p>
      </div>
    </HardwarePageShell>
  );
}
