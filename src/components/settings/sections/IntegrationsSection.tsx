import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { Toggle } from "@/components/shared/Toggle";
import { FormSelect } from "@/components/shared/FormSelect";
import { DirtyDot, ResetButton } from "./shared";
import { getMcpStatus } from "@/mcp/status";
import { buildMcpClientSnippet, MCP_CLIENT_IDS, type McpClientId } from "@/mcp/clientSnippets";
import { writeClipboard } from "@/utils/clipboard";

function CopyRow({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await writeClipboard(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        className="flex-1 min-w-0 text-[11px] px-2.5 py-1.5 rounded-md outline-hidden font-mono"
        style={{
          background: "var(--t-bg-elevated)",
          border: "1px solid var(--t-border)",
          color: "var(--t-text-primary)",
        }}
        value={value}
        onFocus={(e) => e.target.select()}
      />
      <button
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs shrink-0 transition-colors"
        style={{
          background: copied ? "color-mix(in srgb, var(--t-accent) 15%, transparent)" : "var(--t-bg-elevated)",
          color: copied ? "var(--t-accent)" : "var(--t-text-secondary)",
          border: "1px solid var(--t-border)",
        }}
        onClick={copy}
      >
        <Icon icon={copied ? "lucide:check" : "lucide:copy"} width={12} />
        {copied ? t("settings.integrations.mcp.setup.copied") : t("common.action.copy")}
      </button>
    </div>
  );
}

function CopyBlock({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await writeClipboard(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="relative">
      <pre
        className="text-[11px] font-mono whitespace-pre overflow-x-auto px-2.5 py-2 pr-16 rounded-md"
        style={{
          background: "var(--t-bg-elevated)",
          border: "1px solid var(--t-border)",
          color: "var(--t-text-primary)",
        }}
      >
        {value}
      </pre>
      <button
        className="absolute top-1.5 right-1.5 flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors"
        style={{
          background: copied ? "color-mix(in srgb, var(--t-accent) 15%, transparent)" : "var(--t-bg-card)",
          color: copied ? "var(--t-accent)" : "var(--t-text-secondary)",
          border: "1px solid var(--t-border)",
        }}
        onClick={copy}
      >
        <Icon icon={copied ? "lucide:check" : "lucide:copy"} width={12} />
        {copied ? t("settings.integrations.mcp.setup.copied") : t("common.action.copy")}
      </button>
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
  const [status, setStatus] = useState<{ exePath: string; socketPath: string } | null>(null);
  const [clientId, setClientId] = useState<McpClientId>("claude-code");

  const clientOptions = MCP_CLIENT_IDS.map((id) => ({ value: id, label: t(CLIENT_LABEL_KEYS[id]) }));

  useEffect(() => {
    let cancelled = false;
    getMcpStatus()
      .then((s) => {
        if (!cancelled) setStatus({ exePath: s.exePath, socketPath: s.socketPath });
      })
      .catch((err) => console.error("[mcp] could not read status", err));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-6 max-w-lg space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">
          {t("settings.integrations.mcp.title")}
        </h3>
        <div className="rounded-lg bg-(--t-bg-elevated) border border-(--t-border)">
          <div className="group flex items-start justify-between px-4 py-3 gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-(--t-text-primary)">{t("settings.toggleDefs.mcpServer.label")}</p>
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
            <div className="px-4 pb-4 space-y-3 border-t border-(--t-border) pt-3">
              <div>
                <p className="text-xs font-medium text-(--t-text-primary) mb-1">
                  {t("settings.integrations.mcp.setup.title")}
                </p>
                <p className="text-[11px] text-(--t-text-dim) mb-2">
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
                <p className="text-[11px] text-(--t-text-dim) mb-1">
                  {t("settings.integrations.mcp.setup.exePathLabel")}
                </p>
                <CopyRow value={status.exePath} />
              </div>
              <div>
                <p className="text-[11px] text-(--t-text-dim) mb-1">
                  {t("settings.integrations.mcp.setup.socketLabel")}
                </p>
                <CopyRow value={status.socketPath} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
