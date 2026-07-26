import { useTranslation } from "react-i18next";
import { useAgentStore } from "../state/agentStore";

const LABEL = { plan: "⏸ plan", ask: "ask on risky", auto: "⏵⏵ auto-accept" } as const;

export function ModeChip() {
  const { t } = useTranslation();
  const mode = useAgentStore((s) => s.mode);
  const cycle = useAgentStore((s) => s.cycleMode);
  // `mode` is deliberately NOT mutated when a plan is approved — there is no
  // stored value to unwind, so an abnormally terminated run cannot leave the
  // agent permissive. The chip surfaces the lifted state instead.
  const running = useAgentStore((s) => s.planBatch !== null);

  return (
    <button
      type="button"
      onClick={cycle}
      title="shift+tab to cycle"
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
        whiteSpace: "nowrap", background: "transparent",
        border: `1px solid ${running ? "var(--t-accent)" : "var(--t-border)"}`,
        borderRadius: 999, padding: "2px 8px",
        color: running ? "var(--t-accent)" : "var(--t-text-secondary)",
        fontSize: 11, cursor: "pointer",
      }}
    >
      {running ? `${LABEL[mode]} · ${t("aiAgent.plan.runningChip")}` : LABEL[mode]}
    </button>
  );
}
