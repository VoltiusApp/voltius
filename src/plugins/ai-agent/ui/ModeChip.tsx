import { useAgentStore } from "../state/agentStore";

const LABEL = { plan: "⏸ plan", ask: "ask on risky", auto: "⏵⏵ auto-accept" } as const;

export function ModeChip() {
  const mode = useAgentStore((s) => s.mode);
  const cycle = useAgentStore((s) => s.cycleMode);
  return (
    <button
      type="button"
      onClick={cycle}
      title="shift+tab to cycle"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "transparent",
        border: "1px solid var(--t-border)",
        borderRadius: 999,
        padding: "2px 8px",
        color: "var(--t-text-secondary)",
        fontSize: 11,
        cursor: "pointer",
      }}
    >
      {LABEL[mode]} <span style={{ opacity: 0.6 }}>· shift+tab</span>
    </button>
  );
}
