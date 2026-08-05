import { Icon } from "@iconify/react";
import { useAgentStore } from "../state/agentStore";
import { togglePanel } from "../panel";

export function AiTitleBarButton() {
  const runStatus = useAgentStore((s) => s.runStatus);
  const pendingCount = useAgentStore((s) => s.pendingApprovals.length);
  const streaming = runStatus === "streaming";

  return (
    <button
      type="button"
      onClick={togglePanel}
      title="AI Agent"
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 6,
        background: "transparent",
        color: "var(--t-text-secondary)",
      }}
    >
      <Icon icon={streaming ? "lucide:loader-2" : "lucide:sparkles"} width={16} className={streaming ? "animate-spin" : undefined} />
      {pendingCount > 0 && (
        <span
          data-testid="ai-pending-badge"
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--t-status-warning)",
          }}
        />
      )}
    </button>
  );
}
