import { useTranslation } from "react-i18next";
import { TOGGLE_DEFS, useToggle } from "@/stores/toggleSettingsStore";
import { Toggle } from "@/components/shared/Toggle";
import { DirtyDot, ResetButton } from "./shared";

export default function IntegrationsSection() {
  const { t } = useTranslation();
  const [mcpServer, setMcpServer] = useToggle("mcp-server");

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
        </div>
      </div>
    </div>
  );
}
