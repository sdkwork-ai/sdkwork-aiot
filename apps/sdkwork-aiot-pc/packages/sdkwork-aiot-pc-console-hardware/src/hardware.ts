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

export function normalizeHealth(status: string): ConsoleHardwareHealth {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'online' || normalized === 'healthy' || normalized === 'active') {
    return 'healthy';
  }
  if (normalized === 'warning' || normalized === 'degraded' || normalized === 'pending') {
    return 'warning';
  }
  if (normalized === 'offline' || normalized === 'inactive' || normalized === 'disabled') {
    return 'offline';
  }
  return normalized ? 'critical' : 'offline';
}

export function mapDevice(value: unknown): ConsoleHardwareDevice | null {
  const record = readRecord(value);
  const deviceId = readText(record.deviceId) || readText(record.id);
  if (!deviceId) {
    return null;
  }
  const status = readText(record.status, 'unknown');
  const metadata = readRecord(record.metadata);
  return {
    agentId: readText(metadata[DEVICE_AGENT_ID_KEY]),
    agentName: readText(metadata[DEVICE_AGENT_NAME_KEY]),
    chipFamily: readText(record.chipFamily),
    clientId: readText(record.clientId),
    deviceId,
    displayName: readText(record.displayName) || deviceId,
    health: normalizeHealth(status),
    lastSeenAt: readText(record.lastSeenAt),
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

export function formatTimestamp(value: string): string {
  if (!value) {
    return '';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().replace('T', ' ').slice(0, 19);
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
