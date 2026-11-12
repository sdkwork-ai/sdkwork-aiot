import { useState } from "react";
import { Cpu, Play, RefreshCcw } from "lucide-react";
import { Button, LoadingBlock, StatusNotice } from "@sdkwork/ui-pc-react";

import {
  hardwareToolParameters,
  type SdkworkAdminHardwareToolInvocation,
  type SdkworkAdminHardwareTools,
} from "../admin";

export interface SdkworkDeviceHardwareToolsPanelProps {
  error?: string;
  invocation?: SdkworkAdminHardwareToolInvocation | null;
  invokingToolName?: string;
  isLoading: boolean;
  notice?: string;
  onInvoke: (toolName: string, argumentsText: string) => Promise<boolean> | void;
  onRefresh: () => void;
  tools: SdkworkAdminHardwareTools | null;
}

/**
 * Read-only discovery plus explicit actuation for the MCP tools exposed by the
 * device's live Xiaozhi session. Invocation is always user-initiated and shows
 * the raw JSON-RPC result so operators can verify hardware behavior.
 */
export function SdkworkDeviceHardwareToolsPanel({
  error,
  invocation,
  invokingToolName,
  isLoading,
  notice,
  onInvoke,
  onRefresh,
  tools,
}: SdkworkDeviceHardwareToolsPanelProps) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [argumentsText, setArgumentsText] = useState("{}");

  function toggleTool(toolName: string) {
    setActiveTool((current) => (current === toolName ? null : toolName));
    setArgumentsText("{}");
  }

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
            由设备当前小智 MCP 会话的 tools/list 实时发现；选择工具后可携带 JSON 参数调用。
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
          <StatusNotice title="硬件操作失败" tone="danger">
            {error}
          </StatusNotice>
        </div>
      ) : null}

      {notice ? (
        <div className="mt-4">
          <StatusNotice title="工具调用完成" tone="success">
            {notice}
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
              const isActive = activeTool === tool.name;
              const isInvoking = invokingToolName === tool.name;
              return (
                <li className="py-3" key={tool.name}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="rounded bg-[var(--sdk-color-surface-panel)] px-2 py-1 text-xs font-semibold text-[var(--sdk-color-text-primary)]">
                      {tool.name}
                    </code>
                    <div className="flex items-center gap-2">
                      <span className="text-[0.7rem] text-[var(--sdk-color-text-secondary)]">
                        {parameters.length > 0
                          ? `参数：${parameters.join(" / ")}`
                          : "无参数"}
                      </span>
                      <Button
                        onClick={() => toggleTool(tool.name)}
                        type="button"
                        variant="outline"
                      >
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                        {isActive ? "收起" : "调用"}
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-[var(--sdk-color-text-secondary)]">
                    {tool.description || "设备未提供工具描述。"}
                  </p>
                  {isActive ? (
                    <div className="mt-3 rounded-[1.2rem] border border-[var(--sdk-color-border-default)] bg-[var(--sdk-color-surface-panel)] p-4">
                      <label
                        className="text-xs font-semibold text-[var(--sdk-color-text-primary)]"
                        htmlFor={`hardware-tool-args-${tool.name}`}
                      >
                        参数 JSON
                      </label>
                      <textarea
                        className="mt-2 min-h-24 w-full rounded-[0.85rem] border border-[var(--sdk-color-border-default)] bg-transparent p-3 font-mono text-xs text-[var(--sdk-color-text-primary)]"
                        id={`hardware-tool-args-${tool.name}`}
                        onChange={(event) => setArgumentsText(event.target.value)}
                        value={argumentsText}
                      />
                      <div className="mt-3 flex justify-end">
                        <Button
                          disabled={isInvoking}
                          onClick={() => void onInvoke(tool.name, argumentsText)}
                          type="button"
                        >
                          {isInvoking ? "调用中..." : "执行调用"}
                        </Button>
                      </div>
                    </div>
                  ) : null}
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

      {invocation ? (
        <div className="mt-4">
          <div className="text-xs font-semibold text-[var(--sdk-color-text-primary)]">
            {invocation.toolName} 返回结果
          </div>
          <pre className="mt-2 max-h-72 overflow-auto rounded-[1.2rem] bg-[var(--sdk-color-surface-panel)] p-4 text-xs text-[var(--sdk-color-text-secondary)]">
            {JSON.stringify(invocation.result, null, 2)}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
