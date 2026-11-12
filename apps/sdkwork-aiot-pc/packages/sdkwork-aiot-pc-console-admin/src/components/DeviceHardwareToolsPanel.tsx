import { Cpu, RefreshCcw } from "lucide-react";
import { Button, LoadingBlock, StatusNotice } from "@sdkwork/ui-pc-react";

import { hardwareToolParameters, type SdkworkAdminHardwareTools } from "../admin";

export interface SdkworkDeviceHardwareToolsPanelProps {
  error?: string;
  isLoading: boolean;
  onRefresh: () => void;
  tools: SdkworkAdminHardwareTools | null;
}

/**
 * Read-only view of the MCP hardware tools discovered from the device's live
 * Xiaozhi session (audio, screen, camera, board actuators). Discovery is owned
 * by the edge runtime; this panel only renders the admin-facing projection.
 */
export function SdkworkDeviceHardwareToolsPanel({
  error,
  isLoading,
  onRefresh,
  tools,
}: SdkworkDeviceHardwareToolsPanelProps) {
  return (
    <section
      aria-labelledby="device-hardware-tools-heading"
      className="rounded-[1.65rem] border border-[var(--sdk-color-border-default)] bg-[var(--sdk-color-surface-panel)] p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sdk-color-text-secondary)]">
            <Cpu className="h-4 w-4" />
            Device Hardware
          </div>
          <h2
            className="mt-2 text-lg font-semibold text-[var(--sdk-color-text-primary)]"
            id="device-hardware-tools-heading"
          >
            设备硬件能力
          </h2>
          <p className="mt-1 text-xs text-[var(--sdk-color-text-secondary)]">
            由设备当前小智 MCP 会话的 tools/list 实时发现，用于确认摄像头、屏幕、扬声器等板级能力。
          </p>
        </div>
        <Button onClick={onRefresh} type="button" variant="outline">
          <RefreshCcw className="mr-2 h-4 w-4" />
          刷新能力
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={
            tools?.online
              ? "rounded-full bg-emerald-500/10 px-3 py-1 font-medium text-emerald-600"
              : "rounded-full bg-zinc-500/10 px-3 py-1 font-medium text-[var(--sdk-color-text-secondary)]"
          }
        >
          {tools?.online ? "会话在线" : "离线 / 无会话"}
        </span>
        <span className="rounded-full bg-cyan-500/10 px-3 py-1 font-medium text-cyan-700">
          {tools?.discovered
            ? `已发现 ${tools.tools.length} 项工具`
            : "能力发现未完成"}
        </span>
      </div>

      {error ? (
        <div className="mt-4">
          <StatusNotice title="硬件能力读取失败" tone="danger">
            {error}
          </StatusNotice>
        </div>
      ) : null}

      {isLoading ? (
        <div className="mt-4">
          <LoadingBlock label="正在读取设备 MCP 工具..." />
        </div>
      ) : null}

      {!isLoading && !error && tools ? (
        tools.online && tools.tools.length > 0 ? (
          <ul className="mt-4 divide-y divide-[var(--sdk-color-border-default)]">
            {tools.tools.map((tool) => {
              const parameters = hardwareToolParameters(tool);
              return (
                <li className="py-3" key={tool.name}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="rounded bg-[var(--sdk-color-surface-panel)] px-2 py-1 text-xs font-semibold text-[var(--sdk-color-text-primary)]">
                      {tool.name}
                    </code>
                    <span className="text-[0.7rem] text-[var(--sdk-color-text-secondary)]">
                      {parameters.length > 0
                        ? `参数：${parameters.join(" / ")}`
                        : "无参数"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-[var(--sdk-color-text-secondary)]">
                    {tool.description || "设备未提供工具描述。"}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 rounded-[1.2rem] bg-[var(--sdk-color-surface-panel)] px-4 py-3 text-xs leading-6 text-[var(--sdk-color-text-secondary)]">
            {tools.online
              ? "设备在线，但尚未上报 MCP 工具。请确认固件已启用 MCP，或点击刷新重新拉取。"
              : "设备未建立小智 WebSocket 会话；上线后会自动发现硬件工具。"}
          </p>
        )
      ) : null}
    </section>
  );
}
