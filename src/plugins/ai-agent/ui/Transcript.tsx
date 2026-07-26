import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "../state/agentStore";
import { ApprovalCard } from "./ApprovalCard";
import { PlanCard } from "./PlanCard";

export function Transcript() {
  const { t } = useTranslation();
  const transcript = useAgentStore((s) => s.transcript);
  const pendingApprovals = useAgentStore((s) => s.pendingApprovals);
  const errorText = useAgentStore((s) => s.errorText);

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {transcript.map((entry, i) => {
        if (entry.kind === "plan") {
          return <PlanCard key={entry.planId} entry={entry} />;
        }
        if (entry.kind === "tool") {
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "var(--t-text-secondary)",
                background: "var(--t-bg-elevated)",
                border: "1px solid var(--t-border)",
                borderRadius: 6,
                padding: "4px 8px",
                alignSelf: "flex-start",
              }}
            >
              <Icon icon="lucide:terminal" width={12} />
              <span>{entry.tool}</span>
              <span style={{ opacity: 0.7 }}>{entry.state}</span>
              <span style={{ opacity: 0.6 }}>{entry.detail}</span>
            </div>
          );
        }
        const isUser = entry.kind === "user";
        return (
          <div
            key={i}
            style={{
              alignSelf: isUser ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: isUser ? "var(--t-accent)" : "var(--t-bg-elevated)",
              color: isUser ? "var(--t-on-accent, #fff)" : "var(--t-text-bright)",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 13,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {entry.text}
            {/* The attached text itself is deliberately not rendered — it's already on screen in the terminal. */}
            {entry.kind === "user" && entry.attachment && (
              <div style={{ marginTop: 4, fontSize: 11, opacity: 0.75 }}>
                {t("aiAgent.touchpoint.attached", { count: entry.attachment.lineCount })}
              </div>
            )}
          </div>
        );
      })}

      {pendingApprovals.map((p) => (
        <ApprovalCard key={p.id} pending={p} />
      ))}

      {errorText && (
        <div style={{ color: "var(--t-status-error)", fontSize: 12, padding: "4px 0" }}>{errorText}</div>
      )}
    </div>
  );
}
