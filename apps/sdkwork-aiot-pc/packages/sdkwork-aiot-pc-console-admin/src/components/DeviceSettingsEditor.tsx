import { useEffect, useState } from "react";
import { RotateCcw, Save, Undo2 } from "lucide-react";
import { Button, StatusNotice } from "@sdkwork/ui-pc-react";

import {
  formatSettingsChangeAction,
  formatSettingValue,
  groupSettingDefinitions,
  isSettingOverridden,
  parseSettingInput,
  type SdkworkAdminDeviceSettings,
  type SdkworkAdminSettingDefinition,
  type SdkworkAdminSettingsHistoryEntry,
} from "../admin";

export interface SdkworkDeviceSettingsEditorProps {
  disabled?: boolean;
  draftErrors: Record<string, string>;
  draftOverrides: Record<string, unknown>;
  history: SdkworkAdminSettingsHistoryEntry[];
  isLoadingHistory: boolean;
  isSaving: boolean;
  lastError?: string;
  notice?: string;
  onClear: (settingKey: string) => void;
  onDiscard: () => void;
  onReset: () => Promise<boolean> | void;
  onRollback: (revision: string) => void;
  onSave: () => Promise<boolean> | void;
  onSettingChange: (settingKey: string, value: unknown) => void;
  revisionConflict: boolean;
  settings: SdkworkAdminDeviceSettings;
}

function currentValue(
  settings: SdkworkAdminDeviceSettings,
  definition: SdkworkAdminSettingDefinition,
): unknown {
  return Object.prototype.hasOwnProperty.call(settings.overrides, definition.settingKey)
    ? settings.overrides[definition.settingKey]
    : settings.effective[definition.settingKey];
}

function draftValue(
  draftOverrides: Readonly<Record<string, unknown>>,
  settings: SdkworkAdminDeviceSettings,
  definition: SdkworkAdminSettingDefinition,
): unknown {
  return Object.prototype.hasOwnProperty.call(draftOverrides, definition.settingKey)
    ? draftOverrides[definition.settingKey]
    : currentValue(settings, definition);
}

function settingInputId(settingKey: string): string {
  return `device-setting-${settingKey.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function JsonSettingField({
  definition,
  disabled,
  value,
  onChange,
}: {
  definition: SdkworkAdminSettingDefinition;
  disabled: boolean;
  onChange: (value: unknown) => void;
  value: unknown;
}) {
  const [text, setText] = useState(() => formatSettingValue(definition, value));
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const inputId = settingInputId(definition.settingKey);

  useEffect(() => {
    setText(formatSettingValue(definition, value));
  }, [definition, value]);

  return (
    <>
      <textarea
        aria-describedby={localError ? `${inputId}-error` : undefined}
        aria-invalid={localError ? true : undefined}
        className="min-h-28 w-full rounded-[0.85rem] border border-[var(--sdk-color-border-default)] bg-[var(--sdk-color-surface-panel)] px-3 py-2 font-mono text-xs text-[var(--sdk-color-text-primary)] focus:border-sky-500 focus:outline-none"
        disabled={disabled}
        id={inputId}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          try {
            onChange(JSON.parse(next) as unknown);
            setLocalError(undefined);
          } catch {
            setLocalError("Enter valid JSON.");
          }
        }}
        value={text}
      />
      {localError ? (
        <p className="mt-1 text-xs text-rose-500" id={`${inputId}-error`} role="alert">
          {localError}
        </p>
      ) : null}
    </>
  );
}

export function SdkworkDeviceSettingsEditor({
  disabled = false,
  draftErrors,
  draftOverrides,
  history,
  isLoadingHistory,
  isSaving,
  lastError,
  notice,
  onClear,
  onDiscard,
  onReset,
  onRollback,
  onSave,
  onSettingChange,
  revisionConflict,
  settings,
}: SdkworkDeviceSettingsEditorProps) {
  const groups = groupSettingDefinitions(settings.definitions);
  const overriddenCount = Object.keys(settings.overrides).length;
  const draftCount = Object.keys(draftOverrides).length;
  const hasChanges =
    draftCount !== overriddenCount
    || Object.entries(draftOverrides).some(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(settings.overrides[key]),
    );
  const hasErrors = Object.keys(draftErrors).length > 0;

  return (
    <section
      aria-label="Device settings"
      className="rounded-[1.65rem] border border-[var(--sdk-color-border-default)] bg-[var(--sdk-color-surface-panel)] p-5 shadow-[var(--sdk-shadow-sm)]"
    >
      <header className="flex flex-col gap-4 border-b border-[var(--sdk-color-border-default)] pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-600">
            Device configuration
          </div>
          <h2 className="mt-1 text-xl font-semibold text-[var(--sdk-color-text-primary)]">
            {settings.deviceId}
          </h2>
          <p className="mt-1 text-xs text-[var(--sdk-color-text-secondary)]">
            Capability model {settings.capabilityModelId || "unknown"} · revision{" "}
            {settings.revision} · {overriddenCount} 个设备级覆盖 / {settings.definitions.length} 项可配置
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={disabled || isSaving || !hasChanges}
            onClick={onDiscard}
            type="button"
            variant="outline"
          >
            <Undo2 className="mr-2 h-4 w-4" />
            放弃修改
          </Button>
          <Button
            disabled={disabled || isSaving || overriddenCount === 0}
            onClick={() => void onReset()}
            type="button"
            variant="outline"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            恢复继承默认值
          </Button>
          <Button
            disabled={disabled || isSaving || !hasChanges || hasErrors}
            onClick={() => void onSave()}
            type="button"
          >
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? "保存并下发中…" : "保存并下发"}
          </Button>
        </div>
      </header>

      {lastError ? (
        <div className="mt-4">
          <StatusNotice title={revisionConflict ? "Revision 冲突" : "保存失败"} tone="danger">
            {lastError}
          </StatusNotice>
        </div>
      ) : null}

      {notice ? (
        <div className="mt-4">
          <StatusNotice title="设置已更新" tone="success">
            {notice}
          </StatusNotice>
        </div>
      ) : null}

      <div className="mt-5 space-y-6">
        {groups.map((group) => (
          <fieldset className="space-y-4" key={group.group}>
            <legend className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sdk-color-text-secondary)]">
              {group.group}
            </legend>
            <div className="grid gap-4 xl:grid-cols-2">
              {group.definitions.map((definition) => {
                const overridden = isSettingOverridden(settings, definition.settingKey);
                const value = draftValue(draftOverrides, settings, definition);
                const inputId = settingInputId(definition.settingKey);
                const fieldError = draftErrors[definition.settingKey];
                const inheritedValue = formatSettingValue(
                  definition,
                  settings.effective[definition.settingKey],
                );
                const inheritedDisplay = definition.sensitive ? "•••• (sensitive)" : inheritedValue;
                const readOnly = disabled || !definition.writable;

                return (
                  <div
                    className="rounded-[1.2rem] border border-[var(--sdk-color-border-default)] bg-[var(--sdk-color-surface-panel-muted)] p-4"
                    key={definition.settingKey}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <label
                        className="text-sm font-semibold text-[var(--sdk-color-text-primary)]"
                        htmlFor={inputId}
                      >
                        {definition.displayName}
                        {definition.required ? (
                          <span className="ml-1 text-rose-500" aria-hidden="true">
                            *
                          </span>
                        ) : null}
                      </label>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.12em] ${
                            overridden
                              ? "bg-amber-500/15 text-amber-600"
                              : "bg-emerald-500/10 text-emerald-600"
                          }`}
                        >
                          {overridden ? "Override" : "Inherited"}
                        </span>
                        {overridden && definition.writable ? (
                          <button
                            className="text-[0.7rem] font-medium text-sky-600 underline-offset-2 hover:underline"
                            onClick={() => onClear(definition.settingKey)}
                            type="button"
                          >
                            取消覆盖
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <p className="mt-1 font-mono text-[0.7rem] text-[var(--sdk-color-text-secondary)]">
                      {definition.settingKey}
                      {definition.unit ? ` · ${definition.unit}` : ""}
                      {definition.sensitive ? " · sensitive" : ""}
                    </p>
                    {definition.description ? (
                      <p className="mt-1 text-xs leading-5 text-[var(--sdk-color-text-secondary)]">
                        {definition.description}
                      </p>
                    ) : null}

                    <div className="mt-3">
                      {definition.kind === "boolean" ? (
                        <button
                          aria-pressed={value === true}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            value === true
                              ? "border-emerald-500 bg-emerald-500/10 text-emerald-600"
                              : "border-[var(--sdk-color-border-default)] text-[var(--sdk-color-text-secondary)]"
                          }`}
                          disabled={readOnly}
                          id={inputId}
                          onClick={() => onSettingChange(definition.settingKey, value !== true)}
                          type="button"
                        >
                          {value === true ? "已启用" : "已停用"}
                        </button>
                      ) : definition.kind === "enum" ? (
                        <select
                          aria-invalid={fieldError ? true : undefined}
                          className="w-full rounded-[0.85rem] border border-[var(--sdk-color-border-default)] bg-[var(--sdk-color-surface-panel)] px-3 py-2 text-sm text-[var(--sdk-color-text-primary)] focus:border-sky-500 focus:outline-none"
                          disabled={readOnly}
                          id={inputId}
                          onChange={(event) => onSettingChange(definition.settingKey, event.target.value)}
                          value={typeof value === "string" ? value : ""}
                        >
                          {definition.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : definition.kind === "json" ? (
                        <JsonSettingField
                          definition={definition}
                          disabled={readOnly}
                          onChange={(next) => onSettingChange(definition.settingKey, next)}
                          value={value}
                        />
                      ) : (
                        <input
                          aria-invalid={fieldError ? true : undefined}
                          className="w-full rounded-[0.85rem] border border-[var(--sdk-color-border-default)] bg-[var(--sdk-color-surface-panel)] px-3 py-2 text-sm text-[var(--sdk-color-text-primary)] focus:border-sky-500 focus:outline-none"
                          disabled={readOnly}
                          id={inputId}
                          max={definition.maximum}
                          maxLength={definition.maxLength}
                          min={definition.minimum}
                          onChange={(event) => {
                            const raw = event.target.value;
                            if (definition.kind === "string") {
                              onSettingChange(definition.settingKey, raw);
                              return;
                            }
                            // Keep out-of-range numeric input numeric so the
                            // field reports the range rule instead of a type
                            // error; only non-numeric text falls back to the
                            // raw string for inline correction.
                            const numeric = Number(raw);
                            onSettingChange(
                              definition.settingKey,
                              raw.trim().length > 0 && Number.isFinite(numeric) ? numeric : raw,
                            );
                          }}
                          placeholder={inheritedDisplay}
                          step={definition.kind === "integer" ? 1 : "any"}
                          type={definition.kind === "string" ? "text" : "number"}
                          value={value === undefined || value === null ? "" : String(value)}
                        />
                      )}
                    </div>

                    {fieldError ? (
                      <p className="mt-1 text-xs text-rose-500" role="alert">
                        {fieldError}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-[var(--sdk-color-text-secondary)]">
                        继承值：{inheritedDisplay || "—"}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
        {groups.length === 0 ? (
          <StatusNotice title="No configurable settings" tone="default">
            该设备的 capability model 还没有声明任何可配置设置项。
          </StatusNotice>
        ) : null}
      </div>

      <section
        aria-label="Settings history"
        className="mt-6 border-t border-[var(--sdk-color-border-default)] pt-5"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sdk-color-text-secondary)]">
            变更历史
          </h3>
          <span className="text-xs text-[var(--sdk-color-text-secondary)]">
            共 {history.length} 个 revision
          </span>
        </div>

        {isLoadingHistory ? (
          <p className="mt-3 text-xs text-[var(--sdk-color-text-secondary)]">加载历史中…</p>
        ) : null}

        {!isLoadingHistory && history.length === 0 ? (
          <p className="mt-3 text-xs text-[var(--sdk-color-text-secondary)]">
            该设备还没有设置变更记录。保存或重置后会在这里留下可回滚的 revision。
          </p>
        ) : null}

        <ul className="mt-3 space-y-2">
          {history.map((entry) => {
            const isCurrent = entry.revision === settings.revision;
            const meta = [
              entry.changedKeys.length > 0 ? entry.changedKeys.join(", ") : "无字段变化",
              entry.updatedAt ? ` · ${entry.updatedAt}` : "",
              entry.updatedBy ? ` · operator ${entry.updatedBy}` : "",
            ].join("");
            return (
              <li
                className="flex flex-col gap-2 rounded-[1rem] border border-[var(--sdk-color-border-default)] bg-[var(--sdk-color-surface-panel-muted)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                key={`${entry.revision}-${entry.action}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-sky-500/10 px-2 py-0.5 font-mono text-[0.7rem] text-sky-600">
                      r{entry.revision}
                    </span>
                    <span className="font-semibold text-[var(--sdk-color-text-primary)]">
                      {formatSettingsChangeAction(entry.action)}
                    </span>
                    {isCurrent ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-600">
                        当前
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate text-[0.7rem] text-[var(--sdk-color-text-secondary)]">
                    {meta}
                  </div>
                </div>
                <button
                  className="self-start rounded-full border border-[var(--sdk-color-border-default)] px-3 py-1 text-xs font-semibold text-[var(--sdk-color-text-primary)] disabled:opacity-50 sm:self-auto"
                  disabled={disabled || isCurrent}
                  onClick={() => onRollback(entry.revision)}
                  type="button"
                >
                  回滚到此版本
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}
