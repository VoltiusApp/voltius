import { useT } from "../useT";
import { useAgentStore } from "../state/agentStore";

export function ModeChip() {
  const { t } = useT();
  const mode = useAgentStore((s) => s.mode);
  const cycle = useAgentStore((s) => s.cycleMode);
  // `mode` is deliberately NOT mutated when a plan is approved — there is no
  // stored value to unwind, so an abnormally terminated run cannot leave the
  // agent permissive. The chip surfaces the lifted state instead.
  const running = useAgentStore((s) => s.planBatch !== null);
  const label = t(`aiAgent.mode.${mode}`);

  return (
    <button
      type="button"
      onClick={cycle}
      title={t("aiAgent.mode.cycleHint")}
      className={[
        "inline-flex items-center gap-1 shrink-0 whitespace-nowrap bg-transparent rounded-full px-2 py-0.5 text-[11px] cursor-pointer border",
        running ? "border-(--t-accent) text-(--t-accent)" : "border-(--t-border) text-(--t-text-secondary)",
      ].join(" ")}
    >
      {running ? `${label} · ${t("aiAgent.plan.runningChip")}` : label}
    </button>
  );
}
