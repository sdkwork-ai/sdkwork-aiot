import { useEffect } from "react";
import { RefreshCcw, Search, Settings2, ShieldCheck } from "lucide-react";
import { Button, LoadingBlock, StatusNotice } from "@sdkwork/ui-pc-react";

import { formatBulkStatus, type SdkworkAdminDeviceHealth } from "../admin";
import type { SdkworkAdminController } from "../admin-controller";
import {
  useSdkworkAdminController,
  useSdkworkAdminControllerState,
} from "../admin-controller";
import type { SdkworkAdminService } from "../admin-service";
import { SdkworkDeviceHardwareToolsPanel } from "../components/DeviceHardwareToolsPanel";
import { SdkworkDeviceSettingsEditor } from "../components/DeviceSettingsEditor";

export interface SdkworkAdminPageProps {
  controller?: SdkworkAdminController;
  onNavigate?: (route: string) => void;
  service?: Partial<SdkworkAdminService>;
}

const HEALTH_FILTERS: Array<{ id: SdkworkAdminDeviceHealth | "all"; label: string }> = [
  { id: "all", label: "全部" },
  { id: "healthy", label: "在线" },
  { id: "warning", label: "告警" },
  { id: "critical", label: "故障" },
  { id: "offline", label: "离线" },
];

function healthDotClass(health: SdkworkAdminDeviceHealth): string {
  switch (health) {
    case "healthy":
      return "bg-emerald-500";
    case "warning":
      return "bg-amber-500";
    case "offline":
      return "bg-zinc-400";
    default:
      return "bg-rose-500";
  }
}

function bulkStatusClass(status: string): string {
  switch (status) {
    case "updated":
      return "text-emerald-600";
    case "skipped":
      return "text-[var(--sdk-color-text-secondary)]";
    case "conflict":
      return "text-amber-600";
    default:
      return "text-rose-500";
  }
}

export function SdkworkAdminPage({
  controller: controllerProp,
  onNavigate,
  service,
}: SdkworkAdminPageProps) {
  const controller = useSdkworkAdminController(controllerProp, service);
  const state = useSdkworkAdminControllerState(controller);

  useEffect(() => {
    if (!state.isBootstrapped && !state.isLoadingDevices) {
      void controller.bootstrap();
    }
  }, [controller, state.isBootstrapped, state.isLoadingDevices]);

  const healthyCount = state.devices.filter((device) => device.health === "healthy").length;

  return (
    <div className="h-full overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
      <div className="mx-auto max-w-[96rem] space-y-5">
        <section className="overflow-hidden rounded-[2rem] bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_28%),linear-gradient(135deg,#09090b,#111827_48%,#27272a)] px-6 py-7 text-white shadow-[var(--sdk-shadow-lg)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-white/72">
                <Settings2 className="h-3.5 w-3.5" />
                Device Administration
              </div>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight">设备管理控制台</h1>
              <p className="mt-3 text-sm leading-7 text-white/72">
                为每台终端设备查看能力模型继承的配置项、按设备覆盖设置，并在保存时通过 revision
                乐观锁将配置安全下发到设备孪生。
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void controller.refreshDevices()} type="button" variant="outline">
                <RefreshCcw className="mr-2 h-4 w-4" />
                刷新设备
              </Button>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-4">
            <div className="rounded-[1.4rem] bg-white/8 p-5">
              <div className="text-sm text-white/65">受管设备</div>
              <div className="mt-3 text-3xl font-semibold tracking-tight">{state.devices.length}</div>
            </div>
            <div className="rounded-[1.4rem] bg-white/8 p-5">
              <div className="text-sm text-white/65">在线设备</div>
              <div className="mt-3 text-3xl font-semibold tracking-tight">{healthyCount}</div>
            </div>
            <div className="rounded-[1.4rem] bg-white/8 p-5">
              <div className="text-sm text-white/65">当前设置 revision</div>
              <div className="mt-3 text-3xl font-semibold tracking-tight">
                {state.settings?.revision ?? "—"}
              </div>
            </div>
            <div className="rounded-[1.4rem] bg-white/8 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-white/65">设备级覆盖</div>
                  <div className="mt-3 text-3xl font-semibold tracking-tight">
                    {state.settings ? Object.keys(state.settings.overrides).length : "—"}
                  </div>
                </div>
                <ShieldCheck className="h-5 w-5 text-white/80" />
              </div>
            </div>
          </div>
        </section>

        {state.isLoadingDevices && !state.isBootstrapped ? (
          <LoadingBlock label="Loading device administration..." />
        ) : null}

        {state.lastError && !state.settings ? (
          <StatusNotice title="设备管理加载失败" tone="danger">
            {state.lastError}
          </StatusNotice>
        ) : null}

        <section className="grid gap-5 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.6fr)]">
          <div className="rounded-[1.65rem] border border-[var(--sdk-color-border-default)] bg-[var(--sdk-color-surface-panel)] p-5 shadow-[var(--sdk-shadow-sm)]">
            <div className="flex items-center gap-2 rounded-[0.85rem] border border-[var(--sdk-color-border-default)] px-3 py-2">
              <Search className="h-4 w-4 text-[var(--sdk-color-text-secondary)]" aria-hidden="true" />
              <input
                aria-label="搜索设备"
                className="w-full bg-transparent text-sm text-[var(--sdk-color-text-primary)] placeholder:text-[var(--sdk-color-text-secondary)] focus:outline-none"
                onChange={(event) => controller.setSearch(event.target.value)}
                placeholder="按设备 ID、名称或产品筛选"
                type="search"
                value={state.search}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {HEALTH_FILTERS.map((filter) => (
                <button
                  aria-pressed={state.healthFilter === filter.id}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    state.healthFilter === filter.id
                      ? "bg-cyan-500 text-white"
                      : "bg-[var(--sdk-color-surface-panel-muted)] text-[var(--sdk-color-text-secondary)]"
                  }`}
                  key={filter.id}
                  onClick={() => controller.setHealthFilter(filter.id)}
                  type="button"
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-2">
              {state.visibleDevices.map((device) => {
                const active = device.deviceId === state.selectedDeviceId;
                const bulkSelected = state.bulkSelection.includes(device.deviceId);
                return (
                  <div
                    className={`flex items-center gap-2 rounded-[1.1rem] border px-2 py-2 transition-colors ${
                      active
                        ? "border-sky-500 bg-sky-500/10"
                        : "border-[var(--sdk-color-border-default)] hover:bg-[var(--sdk-color-surface-panel-muted)]"
                    }`}
                    key={device.deviceId}
                  >
                    <input
                      aria-label={`批量选择 ${device.displayName}`}
                      checked={bulkSelected}
                      className="h-4 w-4 shrink-0 accent-sky-500"
                      onChange={() => controller.toggleBulkSelection(device.deviceId)}
                      type="checkbox"
                    />
                    <button
                      aria-current={active ? "true" : undefined}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 px-1 py-1 text-left"
                      onClick={() => void controller.selectDevice(device.deviceId)}
                      type="button"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--sdk-color-text-primary)]">
                          {device.displayName}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[0.7rem] text-[var(--sdk-color-text-secondary)]">
                          {device.deviceId}
                          {device.productId ? ` · product ${device.productId}` : ""}
                        </div>
                      </div>
                      <span
                        aria-label={device.health}
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${healthDotClass(device.health)}`}
                      />
                    </button>
                  </div>
                );
              })}
              {state.visibleDevices.length === 0 ? (
                <p className="rounded-[1.1rem] border border-dashed border-[var(--sdk-color-border-default)] px-3 py-6 text-center text-xs text-[var(--sdk-color-text-secondary)]">
                  没有匹配的终端设备。
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            {state.bulkSelection.length > 0 ? (
              <div className="rounded-[1.4rem] border border-sky-500/40 bg-sky-500/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--sdk-color-text-primary)]">
                      已选择 {state.bulkSelection.length} 台设备
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--sdk-color-text-secondary)]">
                      将当前设备的草稿覆盖批量应用到所选设备；每台设备独立校验、独立 revision，并返回逐台结果。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={state.isApplyingBulk}
                      onClick={() => controller.clearBulkSelection()}
                      type="button"
                      variant="outline"
                    >
                      清空选择
                    </Button>
                    <Button
                      disabled={!state.settings || state.isApplyingBulk}
                      onClick={() => void controller.applyBulkToSelection()}
                      type="button"
                    >
                      {state.isApplyingBulk ? "批量应用中…" : "批量应用当前草稿"}
                    </Button>
                  </div>
                </div>
                {state.bulkResult ? (
                  <ul className="mt-3 space-y-1 border-t border-[var(--sdk-color-border-default)] pt-3">
                    {state.bulkResult.items.map((item) => (
                      <li
                        className="flex flex-wrap items-center justify-between gap-2 text-xs"
                        key={item.deviceId}
                      >
                        <span className="font-mono text-[var(--sdk-color-text-secondary)]">
                          {item.deviceId}
                        </span>
                        <span className={`font-semibold ${bulkStatusClass(item.status)}`}>
                          {formatBulkStatus(item.status)}
                          {item.revision ? ` · revision ${item.revision}` : ""}
                        </span>
                        {item.errors.length > 0 ? (
                          <span className="w-full text-rose-500">
                            {item.errors.map((error) => error.message).join("; ")}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {state.isLoadingSettings ? <LoadingBlock label="Loading device settings..." /> : null}
            {!state.isLoadingSettings && state.settings ? (
              <SdkworkDeviceSettingsEditor
                disabled={state.isSaving}
                draftErrors={state.draftErrors}
                draftOverrides={state.draftOverrides}
                history={state.history}
                isLoadingHistory={state.isLoadingHistory}
                isSaving={state.isSaving}
                lastError={state.lastError}
                notice={state.notice}
                onClear={(settingKey) => controller.clearOverride(settingKey)}
                onDiscard={() => controller.discardDraft()}
                onReset={() => controller.resetToDefaults()}
                onRollback={(revision) => void controller.rollbackSettings(revision)}
                onSave={() => controller.save()}
                onSettingChange={(settingKey, value) => controller.setOverride(settingKey, value)}
                revisionConflict={state.revisionConflict}
                settings={state.settings}
              />
            ) : null}
            {state.settings ? (
              <SdkworkDeviceHardwareToolsPanel
                error={state.hardwareToolError ?? state.hardwareToolsError}
                invocation={state.hardwareToolInvocation}
                invokingToolName={state.invokingHardwareTool}
                isLoading={state.isLoadingHardwareTools}
                notice={state.hardwareToolNotice}
                onInvoke={(toolName, argumentsText) =>
                  controller.invokeHardwareTool(toolName, argumentsText)
                }
                onRefresh={() => void controller.refreshHardwareTools()}
                tools={state.hardwareTools}
              />
            ) : null}
            {!state.isLoadingSettings && !state.settings ? (
              <div className="rounded-[1.65rem] border border-dashed border-[var(--sdk-color-border-default)] bg-[var(--sdk-color-surface-panel)] p-8 text-center">
                <p className="text-sm font-medium text-[var(--sdk-color-text-primary)]">
                  选择左侧设备以查看并编辑它的设置
                </p>
                <p className="mt-2 text-xs text-[var(--sdk-color-text-secondary)]">
                  设置项由产品 capability model 声明，设备只保存覆盖值；恢复默认值即清除覆盖并重新继承。
                </p>
                {onNavigate ? (
                  <Button
                    className="mt-4"
                    onClick={() => onNavigate("/iot")}
                    type="button"
                    variant="outline"
                  >
                    前往 IoT 舰队
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
