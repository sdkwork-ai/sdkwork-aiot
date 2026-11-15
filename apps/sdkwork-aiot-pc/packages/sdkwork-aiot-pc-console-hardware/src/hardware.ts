/**
 * Smart Hardware console domain model (SDKWork AIoT PC console).
 *
 * The console is served entirely by the AIoT **app** surface: the signed-in user
 * lists and retrieves the devices they own, registers a new one, reads the
 * firmware catalog, and persists the device-to-agent binding on the device
 * metadata. No management-surface call is involved — the capability lives here,
 * next to the device registry it belongs to.
 *
 * Every wire payload is mapped before a component reads it, so an unknown payload
 * degrades to an empty record instead of throwing during render.
 */

export type ConsoleHardwareHealth = 'critical' | 'healthy' | 'offline' | 'warning';

/**
 * Timestamp the AIoT storage layer reports for a device that was never seen.
 *
 * The device row carries a non-null `last_seen_at` placeholder, so the console
 * must recognize it explicitly instead of presenting 2026-01-01 as a real
 * contact time (and instead of treating the device as online).
 */
export const NEVER_CONNECTED_TIMESTAMP = '2026-01-01T00:00:00Z';

/** A device is online only when it was seen within this window. */
export const DEVICE_ONLINE_WINDOW_MS = 5 * 60 * 1000;

const NEVER_CONNECTED_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
const ISO_OFFSET_SUFFIX = /(?:[zZ]|[+-]\d{2}:?\d{2})$/u;
const CRITICAL_STATUS = /^(?:critical|error|failed|fault|faulted|panic)$/u;
const WARNING_STATUS = /^(?:degraded|maintenance|pending|warning)$/u;
const OFFLINE_STATUS = /^(?:decommissioned|deleted|disabled|inactive|offline|retired)$/u;

export interface ConsoleHardwareDevice {
  agentId: string;
  agentName: string;
  chipFamily: string;
  clientId: string;
  deviceId: string;
  displayName: string;
  health: ConsoleHardwareHealth;
  lastSeenAt: string;
  metadata: Record<string, unknown>;
  productId: string;
  status: string;
}

export interface ConsoleHardwareProduct {
  displayName: string;
  productId: string;
  status: string;
}

export interface ConsoleHardwareFirmware {
  artifactId: string;
  artifactKey: string;
  checksumPreview: string;
  downloadUrl: string;
  fileName: string;
  signature: string;
  status: string;
  targetChipFamily: string;
  targetRuntimeProfile: string;
  version: string;
}

export interface ConsoleHardwareAgent {
  agentId: string;
  description: string;
  name: string;
}

export interface ConsoleHardwareTwin {
  desired: Record<string, unknown>;
  reported: Record<string, unknown>;
}

export interface ConsoleHardwareEvent {
  direction: string;
  eventId: string;
  eventType: string;
  messageClass: string;
  occurredAt: string;
  semanticType: string;
}

export interface ConsoleHardwarePage<T> {
  hasMore: boolean;
  items: T[];
  page: number;
  pageSize: number;
  total?: number;
}

/** Metadata keys that persist the device-to-agent binding. */
export const DEVICE_AGENT_ID_KEY = 'agentId';
export const DEVICE_AGENT_NAME_KEY = 'agentName';

export function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

export function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Parses an AIoT wire timestamp.
 *
 * Postgres values arrive as `YYYY-MM-DDTHH:MM:SS` (UTC, no suffix) while SQLite
 * and seeds carry an explicit `Z`/offset. A bare date-time must be read as UTC,
 * otherwise a console in Asia/Shanghai renders every contact 8 hours late.
 */
export function parseTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const withSeparator = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const candidate = ISO_OFFSET_SUFFIX.test(withSeparator) ? withSeparator : `${withSeparator}Z`;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** True when the value is the storage layer's never-seen placeholder. */
export function isNeverConnectedTimestamp(value: Date): boolean {
  return value.getTime() === NEVER_CONNECTED_EPOCH_MS;
}

/** True when the device has no real contact sample yet. */
export function isNeverConnected(lastSeenAt: string): boolean {
  const parsed = parseTimestamp(lastSeenAt);
  return parsed === null || isNeverConnectedTimestamp(parsed);
}

/**
 * Status-only projection kept for callers without a contact sample.
 *
 * It intentionally does not promote `active` (a lifecycle value) to `healthy`:
 * only an explicit online/healthy status means online.
 */
export function normalizeHealth(status: string): ConsoleHardwareHealth {
  const normalized = status.trim().toLowerCase();
  if (CRITICAL_STATUS.test(normalized)) {
    return 'critical';
  }
  if (WARNING_STATUS.test(normalized)) {
    return 'warning';
  }
  if (normalized === 'online' || normalized === 'healthy' || normalized === 'active') {
    return 'healthy';
  }
  return 'offline';
}

/**
 * Display-grade health: an explicit fault/alert status wins, and otherwise the
 * device counts as online only while its last contact is inside the freshness
 * window. A never-seen device is offline, not healthy.
 */
export function resolveDeviceHealth(
  status: string,
  lastSeenAt: string,
  now: number = Date.now(),
): ConsoleHardwareHealth {
  const normalized = status.trim().toLowerCase();
  if (CRITICAL_STATUS.test(normalized)) {
    return 'critical';
  }
  if (WARNING_STATUS.test(normalized)) {
    return 'warning';
  }
  if (OFFLINE_STATUS.test(normalized)) {
    return 'offline';
  }
  const seenAt = parseTimestamp(lastSeenAt);
  if (!seenAt || isNeverConnectedTimestamp(seenAt)) {
    return 'offline';
  }
  const age = now - seenAt.getTime();
  if (age < 0) {
    // Clock skew between the device edge and this browser: treat as fresh
    // instead of reporting a device that "was seen in the future" as offline.
    return 'healthy';
  }
  return age <= DEVICE_ONLINE_WINDOW_MS ? 'healthy' : 'offline';
}

export function mapDevice(value: unknown): ConsoleHardwareDevice | null {
  const record = readRecord(value);
  const deviceId = readText(record.deviceId) || readText(record.id);
  if (!deviceId) {
    return null;
  }
  const status = readText(record.status, 'unknown');
  const lastSeenAt = readText(record.lastSeenAt);
  const metadata = readRecord(record.metadata);
  return {
    agentId: readText(metadata[DEVICE_AGENT_ID_KEY]),
    agentName: readText(metadata[DEVICE_AGENT_NAME_KEY]),
    chipFamily: readText(record.chipFamily),
    clientId: readText(record.clientId),
    deviceId,
    displayName: readText(record.displayName) || deviceId,
    health: resolveDeviceHealth(status, lastSeenAt),
    lastSeenAt,
    metadata,
    productId: readText(record.productId),
    status,
  };
}

export function mapProduct(value: unknown): ConsoleHardwareProduct | null {
  const record = readRecord(value);
  const productId = readText(record.productId);
  if (!productId) {
    return null;
  }
  return {
    displayName: readText(record.displayName) || productId,
    productId,
    status: readText(record.status, 'active'),
  };
}

/**
 * Resolves a browser-downloadable URL for a firmware binary. The AIoT contract
 * stores a media reference (managed object, drive object, or external URL); only
 * sources that expose a direct URL can be handed to the browser, everything else
 * must go through the managed update channel.
 */
export function firmwareDownloadUrl(resource: Record<string, unknown>): string {
  for (const key of ['publicUrl', 'url', 'uri']) {
    const candidate = readText(resource[key]);
    if (candidate) {
      return candidate;
    }
  }
  return '';
}

export function mapFirmware(value: unknown): ConsoleHardwareFirmware | null {
  const record = readRecord(value);
  const artifactId = readText(record.artifactId);
  if (!artifactId) {
    return null;
  }
  const resource = readRecord(record.resource);
  const sha256 = readText(record.sha256);
  return {
    artifactId,
    artifactKey: readText(record.artifactKey),
    checksumPreview: sha256.slice(0, 16),
    downloadUrl: firmwareDownloadUrl(resource),
    fileName: readText(resource.fileName),
    signature: readText(record.signature),
    status: readText(record.status, 'draft'),
    targetChipFamily: readText(record.targetChipFamily),
    targetRuntimeProfile: readText(record.targetRuntimeProfile),
    version: readText(record.version),
  };
}

export function mapAgent(value: unknown): ConsoleHardwareAgent | null {
  const record = readRecord(value);
  const agentId = readText(record.agentId) || readText(record.id);
  if (!agentId) {
    return null;
  }
  return {
    agentId,
    description: readText(record.description) || readText(record.summary),
    name: readText(record.name) || readText(record.displayName) || agentId,
  };
}

export function mapTwin(value: unknown): ConsoleHardwareTwin {
  const record = readRecord(value);
  const nested = readRecord(record.twin);
  const source = Object.keys(nested).length > 0 ? nested : record;
  return {
    desired: readRecord(source.desired),
    reported: readRecord(source.reported),
  };
}

export function mapEvent(value: unknown): ConsoleHardwareEvent | null {
  const record = readRecord(value);
  const eventId = readText(record.eventId) || readText(record.id);
  if (!eventId) {
    return null;
  }
  return {
    direction: readText(record.direction),
    eventId,
    eventType: readText(record.eventType),
    messageClass: readText(record.messageClass),
    occurredAt: readText(record.occurredAt) || readText(record.createdAt),
    semanticType: readText(record.semanticType),
  };
}

export function mapPage<T>(value: unknown, mapper: (entry: unknown) => T | null): ConsoleHardwarePage<T> {
  const record = readRecord(value);
  const pageInfo = readRecord(record.pageInfo);
  const sourceItems = Array.isArray(record.items)
    ? record.items
    : Array.isArray(value)
      ? value
      : [];
  const items = sourceItems.flatMap((entry): T[] => {
    const mapped = mapper(entry);
    return mapped === null ? [] : [mapped];
  });
  const total = readNumber(pageInfo.total);
  return {
    hasMore: readBoolean(pageInfo.hasMore),
    items,
    page: readNumber(pageInfo.page) ?? 1,
    pageSize: readNumber(pageInfo.pageSize) ?? items.length,
    ...(total === undefined ? {} : { total }),
  };
}

/**
 * Formats an AIoT timestamp in the visitor's local time zone.
 *
 * Returns an empty string for the never-seen placeholder so callers can render
 * their localized "never connected" copy instead of a fake date.
 */
export function formatTimestamp(value: string, locale?: string): string {
  const parsed = parseTimestamp(value);
  if (!parsed || isNeverConnectedTimestamp(parsed)) {
    return '';
  }
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

export interface FormatLastSeenOptions {
  /** Locale for the relative/absolute text; defaults to the browser locale. */
  locale?: string;
  /** Clock seam for tests. */
  now?: number;
  /** Localized "just now" copy; falls back to the absolute timestamp. */
  justNow?: string;
}

/**
 * Human last-seen label: "just now" under a minute, a localized relative value
 * under a week, and the absolute local timestamp beyond that. Never-seen devices
 * return an empty string so the caller can show its own copy.
 */
export function formatLastSeen(value: string, options: FormatLastSeenOptions = {}): string {
  const parsed = parseTimestamp(value);
  if (!parsed || isNeverConnectedTimestamp(parsed)) {
    return '';
  }
  const absolute = formatTimestamp(value, options.locale);
  const age = (options.now ?? Date.now()) - parsed.getTime();
  if (age < 0) {
    return absolute;
  }
  if (age < 60_000) {
    return options.justNow || absolute;
  }
  const relative = new Intl.RelativeTimeFormat(options.locale, { numeric: 'auto' });
  if (age < 3_600_000) {
    return relative.format(-Math.floor(age / 60_000), 'minute');
  }
  if (age < 86_400_000) {
    return relative.format(-Math.floor(age / 3_600_000), 'hour');
  }
  if (age < 7 * 86_400_000) {
    return relative.format(-Math.floor(age / 86_400_000), 'day');
  }
  return absolute;
}

export function jsonText(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
}

export function parseJsonInput(value: string): { ok: boolean; value?: unknown } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Produces device metadata that binds (or unbinds) an agent without disturbing
 * unrelated keys. A `null` agent clears both binding keys.
 */
export function withAgentBinding(
  metadata: Record<string, unknown>,
  agent: Pick<ConsoleHardwareAgent, 'agentId' | 'name'> | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...metadata };
  if (agent) {
    next[DEVICE_AGENT_ID_KEY] = agent.agentId;
    next[DEVICE_AGENT_NAME_KEY] = agent.name;
    return next;
  }
  delete next[DEVICE_AGENT_ID_KEY];
  delete next[DEVICE_AGENT_NAME_KEY];
  return next;
}

export function countHealth(
  devices: readonly ConsoleHardwareDevice[],
): Record<ConsoleHardwareHealth, number> {
  const counts: Record<ConsoleHardwareHealth, number> = { critical: 0, healthy: 0, offline: 0, warning: 0 };
  for (const device of devices) {
    counts[device.health] += 1;
  }
  return counts;
}

export function matchesQuery(values: readonly string[], query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return values.some((value) => value.toLowerCase().includes(normalized));
}
