/**
 * Admin domain types for the SDKWork AIoT control plane.
 *
 * These types mirror the backend admin API (`/backend/v3/api/iot/...`) while
 * keeping the UI independent from generated transport models: every untrusted
 * wire payload passes through the mappers below before it reaches a component.
 */

export type SdkworkAdminDeviceHealth = "critical" | "healthy" | "offline" | "warning";

export type SdkworkAdminSettingKind =
  | "boolean"
  | "enum"
  | "integer"
  | "json"
  | "number"
  | "string";

export interface SdkworkAdminDevice {
  chipFamily: string;
  deviceId: string;
  displayName: string;
  health: SdkworkAdminDeviceHealth;
  lastSeenAt: string;
  productId: string;
  status: string;
}

export interface SdkworkAdminSettingOption {
  label: string;
  value: string;
}

export interface SdkworkAdminSettingDefinition {
  defaultValue?: unknown;
  description?: string;
  displayName: string;
  group: string;
  kind: SdkworkAdminSettingKind;
  maxLength?: number;
  maximum?: number;
  minimum?: number;
  options: SdkworkAdminSettingOption[];
  required: boolean;
  sensitive: boolean;
  settingKey: string;
  unit?: string;
  writable: boolean;
}

export interface SdkworkAdminDeviceSettings {
  capabilityModelId: string;
  defaults: Record<string, unknown>;
  definitions: SdkworkAdminSettingDefinition[];
  deviceId: string;
  effective: Record<string, unknown>;
  overrides: Record<string, unknown>;
  productId: string;
  revision: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface SdkworkAdminDeviceSettingsDraft {
  overrides: Record<string, unknown>;
}

export interface SdkworkAdminDevicePage {
  hasMore: boolean;
  items: SdkworkAdminDevice[];
  page: number;
  pageSize: number;
  total?: number;
}

export interface SdkworkAdminDeviceGroup {
  definitions: SdkworkAdminSettingDefinition[];
  group: string;
}

export type SdkworkAdminSettingsChangeAction = "reset" | "rollback" | "update";

export interface SdkworkAdminSettingsHistoryEntry {
  action: SdkworkAdminSettingsChangeAction;
  changedKeys: string[];
  overrides: Record<string, unknown>;
  revision: string;
  updatedAt: string;
  updatedBy?: string;
}

export type SdkworkAdminBulkItemStatus =
  | "conflict"
  | "failed"
  | "invalid"
  | "not_found"
  | "skipped"
  | "updated";

export interface SdkworkAdminBulkItemError {
  code?: number;
  field?: string;
  message: string;
}

export interface SdkworkAdminBulkItemResult {
  deviceId: string;
  errors: SdkworkAdminBulkItemError[];
  revision?: string;
  status: SdkworkAdminBulkItemStatus;
}

export interface SdkworkAdminBulkResult {
  allOrNothing: boolean;
  items: SdkworkAdminBulkItemResult[];
}

export interface SdkworkAdminSettingsHistoryPage {
  items: SdkworkAdminSettingsHistoryEntry[];
  total?: number;
}

export interface SdkworkAdminHardwareTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface SdkworkAdminHardwareTools {
  deviceId: string;
  online: boolean;
  discovered: boolean;
  tools: SdkworkAdminHardwareTool[];
}

export function mapHardwareTool(value: unknown): SdkworkAdminHardwareTool | null {
  const record = readJsonRecord(value);
  const name = readText(record.name).trim();
  if (!name) {
    return null;
  }
  return {
    name,
    description: readText(record.description),
    inputSchema: readJsonRecord(record.inputSchema),
  };
}

export function mapHardwareTools(
  value: unknown,
  fallbackDeviceId = "",
): SdkworkAdminHardwareTools {
  const record = readJsonRecord(value);
  const tools = Array.isArray(record.tools)
    ? record.tools.flatMap((tool): SdkworkAdminHardwareTool[] => {
        const parsed = mapHardwareTool(tool);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    deviceId: readText(record.deviceId) || fallbackDeviceId,
    online: record.online === true,
    discovered: record.discovered === true,
    tools,
  };
}

export function hardwareToolParameters(tool: SdkworkAdminHardwareTool): string[] {
  const properties = readJsonRecord(tool.inputSchema.properties);
  return Object.keys(properties).sort();
}

export interface SdkworkAdminHardwareToolInvocation {
  deviceId: string;
  toolName: string;
  result: unknown;
}

export function mapHardwareToolInvocation(
  value: unknown,
  fallbackDeviceId = "",
  fallbackToolName = "",
): SdkworkAdminHardwareToolInvocation {
  const record = readJsonRecord(value);
  return {
    deviceId: readText(record.deviceId) || fallbackDeviceId,
    toolName: readText(record.toolName) || fallbackToolName,
    result: record.result,
  };
}

export type SdkworkAdminHardwareToolArgumentsResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

export function parseHardwareToolArguments(
  text: string,
): SdkworkAdminHardwareToolArgumentsResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Arguments must be a JSON object." };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Arguments must be valid JSON." };
  }
}

export interface SdkworkAdminSettingValidation {
  message: string;
  ok: false;
}

export interface SdkworkAdminSettingParseResult {
  ok: boolean;
  value?: unknown;
  message?: string;
}

const SETTING_KINDS: readonly SdkworkAdminSettingKind[] = [
  "boolean",
  "integer",
  "number",
  "string",
  "enum",
  "json",
];

export const ADMIN_SETTINGS_UNGROUPED = "General";

export function normalizeSettingKind(value: unknown): SdkworkAdminSettingKind {
  return typeof value === "string" && (SETTING_KINDS as readonly string[]).includes(value)
    ? (value as SdkworkAdminSettingKind)
    : "json";
}

function normalizeDeviceHealth(status: string): SdkworkAdminDeviceHealth {
  const normalized = status.trim().toLowerCase();
  if (normalized === "online" || normalized === "healthy" || normalized === "active") {
    return "healthy";
  }
  if (normalized === "warning" || normalized === "degraded") {
    return "warning";
  }
  if (normalized === "offline" || normalized === "inactive") {
    return "offline";
  }
  return "critical";
}

function readText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function mapAdminDeviceRecord(value: unknown): SdkworkAdminDevice | null {
  const record = readJsonRecord(value);
  const deviceId = readText(record.deviceId) || readText(record.id);
  if (!deviceId) {
    return null;
  }
  const status = readText(record.status, "unknown");
  return {
    chipFamily: readText(record.chipFamily),
    deviceId,
    displayName: readText(record.displayName) || deviceId,
    health: normalizeDeviceHealth(status),
    lastSeenAt: readText(record.lastSeenAt),
    productId: readText(record.productId),
    status,
  };
}

export function mapAdminSettingDefinition(value: unknown): SdkworkAdminSettingDefinition | null {
  const record = readJsonRecord(value);
  const settingKey = readText(record.settingKey);
  if (!settingKey) {
    return null;
  }
  const options = Array.isArray(record.options)
    ? record.options.flatMap((option): SdkworkAdminSettingOption[] => {
        const optionRecord = readJsonRecord(option);
        const optionValue = readText(optionRecord.value);
        if (!optionValue) {
          return [];
        }
        return [
          {
            label: readText(optionRecord.label, optionValue),
            value: optionValue,
          },
        ];
      })
    : [];
  return {
    ...(record.defaultValue === undefined ? {} : { defaultValue: record.defaultValue }),
    ...(typeof record.description === "string" ? { description: record.description } : {}),
    displayName: readText(record.displayName, settingKey),
    group: readText(record.group, ADMIN_SETTINGS_UNGROUPED) || ADMIN_SETTINGS_UNGROUPED,
    kind: normalizeSettingKind(record.kind),
    ...(readNumberValue(record.maxLength) === undefined
      ? {}
      : { maxLength: readNumberValue(record.maxLength) }),
    ...(readNumberValue(record.maximum) === undefined
      ? {}
      : { maximum: readNumberValue(record.maximum) }),
    ...(readNumberValue(record.minimum) === undefined
      ? {}
      : { minimum: readNumberValue(record.minimum) }),
    options,
    required: record.required === true,
    sensitive: record.sensitive === true,
    settingKey,
    ...(typeof record.unit === "string" ? { unit: record.unit } : {}),
    writable: record.writable !== false,
  };
}

export function mapAdminDeviceSettings(
  value: unknown,
  fallbackDeviceId = "",
): SdkworkAdminDeviceSettings {
  const record = readJsonRecord(value);
  const definitions = Array.isArray(record.definitions)
    ? record.definitions.flatMap((definition): SdkworkAdminSettingDefinition[] => {
        const parsed = mapAdminSettingDefinition(definition);
        return parsed ? [parsed] : [];
      })
    : [];
  const revisionValue = record.revision;
  return {
    capabilityModelId: readText(record.capabilityModelId),
    defaults: readJsonRecord(record.defaults),
    definitions,
    deviceId: readText(record.deviceId) || fallbackDeviceId,
    effective: readJsonRecord(record.effective),
    overrides: readJsonRecord(record.overrides),
    productId: readText(record.productId),
    revision:
      typeof revisionValue === "number"
        ? String(revisionValue)
        : readText(revisionValue, "0"),
    ...(typeof record.updatedAt === "string" ? { updatedAt: record.updatedAt } : {}),
    ...(typeof record.updatedBy === "string" ? { updatedBy: record.updatedBy } : {}),
  };
}

/**
 * Groups definitions by their declared `group`, preserving the order in which
 * groups first appear so operator forms stay stable between renders.
 */
export function groupSettingDefinitions(
  definitions: readonly SdkworkAdminSettingDefinition[],
): SdkworkAdminDeviceGroup[] {
  const groups = new Map<string, SdkworkAdminSettingDefinition[]>();
  for (const definition of definitions) {
    const group = definition.group || ADMIN_SETTINGS_UNGROUPED;
    const current = groups.get(group);
    if (current) {
      current.push(definition);
    } else {
      groups.set(group, [definition]);
    }
  }
  return Array.from(groups, ([group, groupDefinitions]) => ({
    definitions: groupDefinitions,
    group,
  }));
}

export function isSettingOverridden(
  settings: Pick<SdkworkAdminDeviceSettings, "overrides">,
  settingKey: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(settings.overrides, settingKey);
}

export function effectiveSettingValue(
  settings: Pick<SdkworkAdminDeviceSettings, "effective" | "overrides">,
  settingKey: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(settings.overrides, settingKey)
    ? settings.overrides[settingKey]
    : settings.effective[settingKey];
}

function formatScalar(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function formatSettingValue(
  definition: SdkworkAdminSettingDefinition,
  value: unknown,
): string {
  if (value === undefined) {
    return "";
  }
  if (definition.kind === "enum") {
    const option = definition.options.find((candidate) => candidate.value === value);
    return option?.label ?? formatScalar(value);
  }
  if (definition.kind === "json") {
    return JSON.stringify(value ?? null, null, 2);
  }
  return formatScalar(value);
}

/**
 * Parses an operator input string into the JSON value the admin API expects for
 * the declared setting kind. Returns a field-scoped failure message rather than
 * throwing so controllers can aggregate errors.
 */
export function parseSettingInput(
  definition: SdkworkAdminSettingDefinition,
  raw: string | boolean,
): SdkworkAdminSettingParseResult {
  if (!definition.writable) {
    return { message: "This setting is read-only.", ok: false };
  }

  switch (definition.kind) {
    case "boolean": {
      if (typeof raw === "boolean") {
        return { ok: true, value: raw };
      }
      const normalized = raw.trim().toLowerCase();
      if (["true", "1", "on", "yes"].includes(normalized)) {
        return { ok: true, value: true };
      }
      if (["false", "0", "off", "no"].includes(normalized)) {
        return { ok: true, value: false };
      }
      return { message: "Enter true or false.", ok: false };
    }
    case "integer": {
      if (typeof raw === "boolean" || raw.trim().length === 0) {
        return { message: "Enter a whole number.", ok: false };
      }
      const parsed = Number(raw);
      if (!Number.isInteger(parsed)) {
        return { message: "Enter a whole number.", ok: false };
      }
      return validateNumericRange(definition, parsed);
    }
    case "number": {
      if (typeof raw === "boolean" || raw.trim().length === 0) {
        return { message: "Enter a number.", ok: false };
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return { message: "Enter a number.", ok: false };
      }
      return validateNumericRange(definition, parsed);
    }
    case "string": {
      const text = typeof raw === "boolean" ? String(raw) : raw;
      if (definition.maxLength !== undefined && text.length > definition.maxLength) {
        return {
          message: `Use at most ${definition.maxLength} characters.`,
          ok: false,
        };
      }
      return { ok: true, value: text };
    }
    case "enum": {
      const text = typeof raw === "boolean" ? String(raw) : raw;
      if (!definition.options.some((option) => option.value === text)) {
        return {
          message: `Choose one of: ${definition.options.map((option) => option.value).join(", ")}.`,
          ok: false,
        };
      }
      return { ok: true, value: text };
    }
    case "json": {
      if (typeof raw === "boolean") {
        return { ok: true, value: raw };
      }
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        return { message: "Enter a JSON value.", ok: false };
      }
      try {
        return { ok: true, value: JSON.parse(trimmed) as unknown };
      } catch {
        return { message: "Enter valid JSON.", ok: false };
      }
    }
    default:
      return { message: "Unsupported setting kind.", ok: false };
  }
}

function validateNumericRange(
  definition: SdkworkAdminSettingDefinition,
  value: number,
): SdkworkAdminSettingParseResult {
  if (definition.minimum !== undefined && value < definition.minimum) {
    return {
      message: `Must be at least ${definition.minimum}.`,
      ok: false,
    };
  }
  if (definition.maximum !== undefined && value > definition.maximum) {
    return {
      message: `Must be at most ${definition.maximum}.`,
      ok: false,
    };
  }
  return { ok: true, value };
}

/**
 * Validates a whole draft. Required settings are satisfied by the inherited
 * default, so only keys with an explicit draft value are type-checked here.
 */
export function validateSettingsDraft(
  definitions: readonly SdkworkAdminSettingDefinition[],
  overrides: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const definitionsByKey = new Map(
    definitions.map((definition) => [definition.settingKey, definition]),
  );
  for (const [settingKey, value] of Object.entries(overrides)) {
    const definition = definitionsByKey.get(settingKey);
    if (!definition) {
      errors[settingKey] = "This setting is not defined by the capability model.";
      continue;
    }
    if (!definition.writable) {
      errors[settingKey] = "This setting is read-only.";
      continue;
    }
    const result = validateValueAgainstDefinition(definition, value);
    if (!result.ok && result.message) {
      errors[settingKey] = result.message;
    }
  }
  for (const definition of definitions) {
    if (
      definition.required
      && definition.defaultValue === undefined
      && !Object.prototype.hasOwnProperty.call(overrides, definition.settingKey)
    ) {
      errors[definition.settingKey] = "This setting is required.";
    }
  }
  return errors;
}

function validateValueAgainstDefinition(
  definition: SdkworkAdminSettingDefinition,
  value: unknown,
): SdkworkAdminSettingParseResult {
  switch (definition.kind) {
    case "boolean":
      return typeof value === "boolean"
        ? { ok: true, value }
        : { message: "Must be a boolean.", ok: false };
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? validateNumericRange(definition, value)
        : { message: "Must be a whole number.", ok: false };
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? validateNumericRange(definition, value)
        : { message: "Must be a number.", ok: false };
    case "string":
      return typeof value === "string"
        && (definition.maxLength === undefined || value.length <= definition.maxLength)
        ? { ok: true, value }
        : { message: "Must be a string within the declared length.", ok: false };
    case "enum":
      return typeof value === "string"
        && definition.options.some((option) => option.value === value)
        ? { ok: true, value }
        : { message: "Must be one of the declared options.", ok: false };
    case "json":
      return { ok: true, value };
    default:
      return { message: "Unsupported setting kind.", ok: false };
  }
}

export function countOverrides(overrides: Readonly<Record<string, unknown>>): number {
  return Object.keys(overrides).length;
}

export function normalizeSettingsChangeAction(
  value: unknown,
): SdkworkAdminSettingsChangeAction {
  return value === "reset" || value === "rollback" ? value : "update";
}

export function formatSettingsChangeAction(
  action: SdkworkAdminSettingsChangeAction,
): string {
  switch (action) {
    case "reset":
      return "恢复默认值";
    case "rollback":
      return "回滚";
    default:
      return "保存修改";
  }
}

export function mapSettingsHistoryEntry(
  value: unknown,
): SdkworkAdminSettingsHistoryEntry | null {
  const record = readJsonRecord(value);
  const revisionValue = record.revision;
  const revision =
    typeof revisionValue === "number" ? String(revisionValue) : readText(revisionValue);
  if (!revision) {
    return null;
  }
  return {
    action: normalizeSettingsChangeAction(record.action),
    changedKeys: Array.isArray(record.changedKeys)
      ? record.changedKeys.flatMap((key): string[] => {
          const text = readText(key);
          return text ? [text] : [];
        })
      : [],
    overrides: readJsonRecord(record.overrides),
    revision,
    updatedAt: readText(record.updatedAt),
    ...(typeof record.updatedBy === "string" ? { updatedBy: record.updatedBy } : {}),
  };
}

export function mapSettingsHistoryPage(value: unknown): SdkworkAdminSettingsHistoryPage {
  const record = readJsonRecord(value);
  const items = Array.isArray(record.items)
    ? record.items.flatMap((item): SdkworkAdminSettingsHistoryEntry[] => {
        const entry = mapSettingsHistoryEntry(item);
        return entry ? [entry] : [];
      })
    : [];
  const pageInfo = readJsonRecord(record.pageInfo);
  return {
    items,
    ...(typeof pageInfo.total === "number" ? { total: pageInfo.total } : {}),
  };
}

function normalizeBulkStatus(value: unknown): SdkworkAdminBulkItemStatus {
  switch (value) {
    case "updated":
    case "skipped":
    case "invalid":
    case "not_found":
    case "conflict":
    case "failed":
      return value;
    default:
      return "failed";
  }
}

export function mapBulkResult(value: unknown): SdkworkAdminBulkResult {
  const record = readJsonRecord(value);
  const items = Array.isArray(record.items)
    ? record.items.map((item): SdkworkAdminBulkItemResult => {
        const itemRecord = readJsonRecord(item);
        const errors = Array.isArray(itemRecord.errors)
          ? itemRecord.errors.map((error): SdkworkAdminBulkItemError => {
              const errorRecord = readJsonRecord(error);
              return {
                ...(typeof errorRecord.code === "number" ? { code: errorRecord.code } : {}),
                ...(typeof errorRecord.field === "string" ? { field: errorRecord.field } : {}),
                message: readText(errorRecord.message),
              };
            })
          : [];
        const revisionValue = itemRecord.revision;
        const revision =
          typeof revisionValue === "number"
            ? String(revisionValue)
            : readText(revisionValue);
        return {
          deviceId: readText(itemRecord.deviceId),
          errors,
          ...(revision ? { revision } : {}),
          status: normalizeBulkStatus(itemRecord.status),
        };
      })
    : [];
  return {
    allOrNothing: record.allOrNothing === true,
    items,
  };
}

export function formatBulkStatus(status: SdkworkAdminBulkItemStatus): string {
  switch (status) {
    case "updated":
      return "已更新";
    case "skipped":
      return "已跳过";
    case "invalid":
      return "校验失败";
    case "not_found":
      return "设备不存在";
    case "conflict":
      return "Revision 冲突";
    default:
      return "失败";
  }
}

export function summarizeBulkResult(result: SdkworkAdminBulkResult): string {
  const counts = new Map<SdkworkAdminBulkItemStatus, number>();
  for (const item of result.items) {
    counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  }
  return Array.from(counts, ([status, count]) => `${formatBulkStatus(status)} ${count}`).join(" · ");
}

export const adminPackageMeta = {
  architecture: "pc-console",
  capability: "device-settings-admin",
  domain: "admin",
  package: "@sdkwork/aiot-pc-console-admin",
  product: "sdkwork-aiot",
  status: "ready",
} as const;

export type AdminPackageMeta = typeof adminPackageMeta;
