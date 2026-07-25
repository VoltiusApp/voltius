import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PluginAPI } from "@/plugins/api";
import type { Mode } from "../state/agentStore";

/**
 * The GLOBAL default mode for new conversations.
 *
 * `initAgent` already reads the `agentMode` storage key and nothing has ever
 * written it — this select is its sole writer. Deliberately does NOT touch
 * `useAgentStore.mode`: the drawer's Shift+Tab override is per-conversation,
 * so changing the default must not disturb a conversation already in progress.
 */
export function PermissionsBlock({ api }: { api: PluginAPI }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    void api.storage.get<Mode>("agentMode").then((m) => setMode(m ?? "ask"));
  }, [api]);

  const onChange = (next: Mode) => {
    setMode(next);
    void api.storage.set("agentMode", next);
  };

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
        {t("aiAgent.settings.permissions.heading")}
      </h3>
      <div className="group rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-(--t-text-primary)">
            {t("aiAgent.settings.permissions.defaultMode.title")}
          </div>
          <div className="text-xs mt-1 text-(--t-text-dim)">
            {t("aiAgent.settings.permissions.defaultMode.desc")}
          </div>
        </div>
        <select
          aria-label={t("aiAgent.settings.permissions.defaultMode.title")}
          value={mode ?? "ask"}
          onChange={(e) => onChange(e.target.value as Mode)}
          className="form-input px-3 py-2 rounded-lg text-sm bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) shrink-0"
        >
          <option value="plan">{t("aiAgent.settings.permissions.defaultMode.plan")}</option>
          <option value="ask">{t("aiAgent.settings.permissions.defaultMode.ask")}</option>
          <option value="auto">{t("aiAgent.settings.permissions.defaultMode.auto")}</option>
        </select>
      </div>
    </section>
  );
}
