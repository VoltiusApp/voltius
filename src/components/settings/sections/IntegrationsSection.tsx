import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { Toggle } from "@/components/shared/Toggle";
import { FormSelect } from "@/components/shared/FormSelect";
import { DirtyDot, ResetButton } from "./shared";
import { getMcpStatus } from "@/mcp/status";
import { buildMcpClientSnippet, MCP_CLIENT_IDS, type McpClientId } from "@/mcp/clientSnippets";
import { buildAddMcpCommand } from "@/mcp/registerCommand";
import { writeClipboard } from "@/utils/clipboard";
import { contributionsByPlugin, onContributionsChanged } from "@/mcp/contributions";
import { useMcpContributionStore, setPluginExposed } from "@/stores/mcpContributionStore";
import { getLoadedPlugins } from "@/plugins/runtime";

/** The installed plugin's manifest name, or its id when it is not loaded —
 *  a contribution can outlive nothing, but the id is never blank. */
function pluginDisplayName(pluginId: string): string {
  return getLoadedPlugins().find((m) => m.id === pluginId)?.name ?? pluginId;
}

function useCopy(value: string) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    await writeClipboard(value);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return { copied, copy };
}

function CopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  const { t } = useTranslation();
  const label = copied ? t("settings.integrations.mcp.setup.copied") : t("common.action.copy");

  return (
    <button
      className={`flex items-center justify-center w-6 h-6 rounded transition-colors shrink-0 ${
        copied
          ? "text-(--t-accent)"
          : "text-(--t-text-dim) hover:text-(--t-text-primary) hover:bg-(--t-bg-card-hover)"
      }`}
      title={label}
      aria-label={label}
      onClick={onCopy}
    >
      <Icon icon={copied ? "lucide:check" : "lucide:copy"} width={13} />
    </button>
  );
}

function CopyRow({ value }: { value: string }) {
  const { copied, copy } = useCopy(value);

  return (
    <div className="flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-md bg-(--t-bg-base) border border-(--t-border)">
      <input
        readOnly
        className="flex-1 min-w-0 text-[11px] py-0.5 outline-hidden font-mono bg-transparent text-(--t-text-primary)"
        value={value}
        onFocus={(e) => e.target.select()}
      />
      <CopyButton copied={copied} onCopy={copy} />
    </div>
  );
}

function CopyBlock({ value }: { value: string }) {
  const { copied, copy } = useCopy(value);

  return (
    <div className="relative rounded-md bg-(--t-bg-base) border border-(--t-border)">
      <pre className="text-[11px] font-mono whitespace-pre overflow-x-auto px-2.5 py-2 pr-9 text-(--t-text-primary)">
        {value}
      </pre>
      <div className="absolute top-1 right-1">
        <CopyButton copied={copied} onCopy={copy} />
      </div>
    </div>
  );
}

const CLIENT_LABEL_KEYS: Record<McpClientId, string> = {
  "claude-code": "settings.integrations.mcp.setup.clients.claudeCode",
  "mcp-servers": "settings.integrations.mcp.setup.clients.mcpServers",
  vscode: "settings.integrations.mcp.setup.clients.vscode",
  opencode: "settings.integrations.mcp.setup.clients.opencode",
};

const CLIENT_HELP_KEYS: Record<McpClientId, string> = {
  "claude-code": "settings.integrations.mcp.setup.help.claudeCode",
  "mcp-servers": "settings.integrations.mcp.setup.help.mcpServers",
  vscode: "settings.integrations.mcp.setup.help.vscode",
  opencode: "settings.integrations.mcp.setup.help.opencode",
};

export default function IntegrationsSection() {
  const { t } = useTranslation();
  const [mcpServer, setMcpServer] = useToggle("mcp-server");
  const [status, setStatus] = useState<{ enabled: boolean; exePath: string; socketPath: string } | null>(null);
  const [clientId, setClientId] = useState<McpClientId>("claude-code");
  const [manualOpen, setManualOpen] = useState(false);
  const [contributions, setContributions] = useState(() => [...contributionsByPlugin().entries()]);
  const exposed = useMcpContributionStore((s) => s.exposed);

  useEffect(() => onContributionsChanged(() => setContributions([...contributionsByPlugin().entries()])), []);

  const clientOptions = MCP_CLIENT_IDS.map((id) => ({ value: id, label: t(CLIENT_LABEL_KEYS[id]) }));

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      getMcpStatus()
        .then((s) => {
          if (!cancelled) setStatus({ enabled: s.enabled, exePath: s.exePath, socketPath: s.socketPath });
        })
        .catch((err) => console.error("[mcp] could not read status", err));
    };
    read();
    // The root useMcpServerSync hook pushes the toggle to the backend; give
    // that flip a beat to land, then read the listener state back.
    const timer = setTimeout(read, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mcpServer]);

  return (
    <div className="p-6 max-w-lg space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.integrations.mcp.title")}
        </h3>
        <div className="rounded-lg bg-(--t-bg-elevated) border border-(--t-border)">
          <div className="group flex items-start justify-between px-4 py-3 gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.toggleDefs.mcpServer.label")}</p>
                {status?.enabled && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-(--t-status-connected)/10 text-(--t-status-connected)">
                    <span className="w-1.5 h-1.5 rounded-full bg-(--t-status-connected)" />
                    {t("settings.integrations.mcp.running")}
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("settings.integrations.mcp.sub")}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {mcpServer !== TOGGLE_DEFS["mcp-server"].default && (
                <ResetButton onReset={() => setMcpServer(TOGGLE_DEFS["mcp-server"].default)} />
              )}
              {mcpServer !== TOGGLE_DEFS["mcp-server"].default && <DirtyDot />}
              <Toggle checked={mcpServer} onChange={setMcpServer} />
            </div>
          </div>
          {status && (
            <div className="px-4 pb-4 space-y-4 border-t border-(--t-border) pt-3.5">
              <div>
                <p className="text-xs font-medium text-(--t-text-primary)">
                  {t("settings.integrations.mcp.quickSetup.title")}
                </p>
                <p className="text-[11px] text-(--t-text-dim) mt-0.5 mb-2">
                  {t("settings.integrations.mcp.quickSetup.help")}
                </p>
                <CopyRow value={buildAddMcpCommand(status.exePath)} />
              </div>

              <div>
                <button
                  className="group/manual flex items-center gap-1.5 -ml-1 pl-1 pr-2 py-1 rounded-md text-[11px] font-medium text-(--t-text-secondary) hover:text-(--t-text-primary) hover:bg-(--t-bg-card-hover) transition-colors"
                  aria-expanded={manualOpen}
                  onClick={() => setManualOpen((v) => !v)}
                >
                  <Icon
                    icon="lucide:chevron-right"
                    width={13}
                    className={`text-(--t-text-dim) transition-transform duration-150 ${manualOpen ? "rotate-90" : ""}`}
                  />
                  {t("settings.integrations.mcp.manualSetup.toggleLabel")}
                </button>
                {manualOpen && (
                  <div className="mt-2 ml-1.5 pl-3.5 space-y-4 border-l border-(--t-border)">
                    <p className="text-[11px] text-(--t-text-dim)">
                      {t("settings.integrations.mcp.manualSetup.toggleSub")}
                    </p>
                    <div>
                      <p className="text-xs font-medium text-(--t-text-primary)">
                        {t("settings.integrations.mcp.setup.title")}
                      </p>
                      <p className="text-[11px] text-(--t-text-dim) mt-0.5 mb-2">
                        {t("settings.integrations.mcp.setup.clientLabel")}
                      </p>
                      <FormSelect
                        className="mb-2"
                        value={clientId}
                        options={clientOptions}
                        onChange={(v) => setClientId(v as McpClientId)}
                        ariaLabel={t("settings.integrations.mcp.setup.clientLabel")}
                      />
                      <p className="text-[11px] text-(--t-text-dim) mb-2">
                        {t(CLIENT_HELP_KEYS[clientId])}
                      </p>
                      {clientId === "claude-code" ? (
                        <CopyRow value={buildMcpClientSnippet(clientId, status.exePath)} />
                      ) : (
                        <CopyBlock value={buildMcpClientSnippet(clientId, status.exePath)} />
                      )}
                    </div>
                    <div>
                      <p className="text-[11px] text-(--t-text-dim) mb-1.5">
                        {t("settings.integrations.mcp.setup.exePathLabel")}
                      </p>
                      <CopyRow value={status.exePath} />
                    </div>
                    <div>
                      <p className="text-[11px] text-(--t-text-dim) mb-1.5">
                        {t("settings.integrations.mcp.setup.socketLabel")}
                      </p>
                      <CopyRow value={status.socketPath} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.integrations.mcp.plugins.title")}
        </h3>
        <p className="text-xs mb-3 text-(--t-text-dim)">{t("settings.integrations.mcp.plugins.sub")}</p>
        <div className="rounded-lg bg-(--t-bg-elevated) border border-(--t-border)">
          {contributions.length === 0 ? (
            <p className="px-4 py-3 text-xs text-(--t-text-dim)">
              {t("settings.integrations.mcp.plugins.empty")}
            </p>
          ) : (
            contributions.map(([pluginId, tools], i) => (
              <div
                key={pluginId}
                className={`flex items-start justify-between px-4 py-3 gap-4 ${i > 0 ? "border-t border-(--t-border)" : ""}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-(--t-text-primary)">
                    {pluginDisplayName(pluginId)}
                  </p>
                  <p className="text-xs mt-0.5 text-(--t-text-dim)">
                    {t("settings.integrations.mcp.plugins.count", { count: tools.length })}
                  </p>
                  <p className="text-[11px] mt-1 font-mono break-all text-(--t-text-dim)">
                    {tools.map((tool) => tool.name).join(", ")}
                  </p>
                </div>
                <label className="shrink-0" aria-label={pluginDisplayName(pluginId)}>
                  <Toggle
                    checked={exposed[pluginId] ?? true}
                    onChange={(v) => {
                      setPluginExposed(pluginId, v);
                      void invoke("mcp_notify_tools_changed").catch(() => {});
                    }}
                  />
                </label>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
