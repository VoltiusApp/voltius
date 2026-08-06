import { useEffect, useState } from "react";
import { FormSelect } from "@voltius/ui";
import { useT } from "../useT";
import type { PluginAPI } from "@/plugins/api";
import type { Mode } from "../state/agentStore";
import { auditAgentAction } from "../state/auditSeam";

/**
 * The GLOBAL default mode for new conversations.
 *
 * `initAgent` already reads the `agentMode` storage key and nothing has ever
 * written it — this select is its sole writer. Deliberately does NOT touch
 * `useAgentStore.mode`: the drawer's Shift+Tab override is per-conversation,
 * so changing the default must not disturb a conversation already in progress.
 */
const MODES: Mode[] = ["plan", "ask", "auto"];

export function PermissionsBlock({ api }: { api: PluginAPI }) {
  const { t } = useT();
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    void api.storage.get<Mode>("agentMode").then((m) => setMode(m ?? "ask"));
  }, [api]);

  const onChange = (next: Mode) => {
    const from = mode ?? "ask";
    if (next === from) return;
    setMode(next);
    void api.storage.set("agentMode", next);
    auditAgentAction("local", "agent.mode_changed", { from, to: next, target: "default" });
  };

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
        {t("aiAgent.settings.permissions.heading")}
      </h3>
      <div className="group rounded-xl bg-(--t-bg-card) border border-(--t-border) p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-(--t-text-primary)">
            {t("aiAgent.settings.permissions.defaultMode.title")}
          </div>
          <div className="text-xs mt-1 text-(--t-text-dim)">
            {t("aiAgent.settings.permissions.defaultMode.desc")}
          </div>
        </div>
        <FormSelect
          className="max-w-[14rem] w-full shrink-0"
          ariaLabel={t("aiAgent.settings.permissions.defaultMode.title")}
          value={mode ?? "ask"}
          options={MODES.map((m) => ({
            value: m,
            label: t(`aiAgent.settings.permissions.defaultMode.${m}`),
          }))}
          onChange={(v) => onChange(v as Mode)}
        />
      </div>
    </section>
  );
}
