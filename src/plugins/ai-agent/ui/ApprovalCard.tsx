import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useAgentStore, type PendingApproval } from "../state/agentStore";
import type { AllowlistEntry } from "../state/allowlist";

function summarizeArgs(pending: PendingApproval): string {
  if (pending.tool === "run_command" && typeof pending.args.command === "string") return pending.args.command;
  return JSON.stringify(pending.args);
}

export function ApprovalCard({ pending }: { pending: PendingApproval }) {
  const { t } = useTranslation();
  const resolveApproval = useAgentStore((s) => s.resolveApproval);
  const addAllowlist = useAgentStore((s) => s.addAllowlist);

  const [editing, setEditing] = useState(false);
  const [command, setCommand] = useState(String(pending.args.command ?? ""));
  const [connectionId, setConnectionId] = useState(String(pending.args.connectionId ?? ""));

  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const grantLabel = (g: AllowlistEntry) =>
    g.grain === "exact"
      ? t("aiAgent.approval.always.exact", { command: g.key, host: g.host })
      : t("aiAgent.approval.always.tool", { tool: g.tool, host: g.host });

  const onApprove = () => resolveApproval(pending.id, { approve: true });

  const onAlways = (g: AllowlistEntry) => {
    addAllowlist(g);
    resolveApproval(pending.id, { approve: true });
  };

  const onSaveEdit = () => {
    const args = { ...pending.args };
    if ("command" in pending.args) args.command = command;
    if ("connectionId" in pending.args) args.connectionId = connectionId;
    resolveApproval(pending.id, { approve: true, args });
  };

  const onConfirmReject = () => {
    resolveApproval(pending.id, { approve: false, reason: reason.trim() || undefined });
  };

  return (
    <div
      style={{
        border: "1px solid var(--t-border)",
        borderRadius: 8,
        padding: 10,
        background: "var(--t-bg-elevated)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon icon="lucide:shield-alert" width={14} style={{ color: "var(--t-status-warning)" }} />
        <span style={{ color: "var(--t-text-bright)", fontWeight: 600 }}>{pending.tool}</span>
        <span style={{ color: "var(--t-text-secondary)" }}>on {pending.host}</span>
        <span
          style={{
            marginLeft: "auto",
            color: "var(--t-status-warning)",
            border: "1px solid color-mix(in srgb, var(--t-status-warning) 40%, transparent)",
            borderRadius: 999,
            padding: "0 6px",
            fontSize: 10,
          }}
        >
          needs approval
        </span>
      </div>

      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {"command" in pending.args && (
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="command"
              style={{ background: "var(--t-bg-modal)", border: "1px solid var(--t-border)", color: "var(--t-text-bright)", borderRadius: 4, padding: "4px 6px" }}
            />
          )}
          {"connectionId" in pending.args && (
            <input
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              placeholder="connectionId"
              style={{ background: "var(--t-bg-modal)", border: "1px solid var(--t-border)", color: "var(--t-text-bright)", borderRadius: 4, padding: "4px 6px" }}
            />
          )}
        </div>
      ) : (
        <code style={{ color: "var(--t-text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{summarizeArgs(pending)}</code>
      )}

      {rejecting && (
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="reason (optional)"
          style={{ background: "var(--t-bg-modal)", border: "1px solid var(--t-border)", color: "var(--t-text-bright)", borderRadius: 4, padding: "4px 6px" }}
        />
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {editing ? (
          <>
            <button type="button" onClick={onSaveEdit} style={{ color: "var(--t-status-connected)" }}>Save & Approve</button>
            <button type="button" onClick={() => setEditing(false)} style={{ color: "var(--t-text-secondary)" }}>Cancel</button>
          </>
        ) : rejecting ? (
          <>
            <button type="button" onClick={onConfirmReject} style={{ color: "var(--t-status-error)" }}>Confirm Reject</button>
            <button type="button" onClick={() => setRejecting(false)} style={{ color: "var(--t-text-secondary)" }}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" onClick={onApprove} style={{ color: "var(--t-status-connected)" }}>Approve</button>
            {pending.grants.map((g) => (
              <button
                key={`${g.grain}:${g.key}`}
                type="button"
                onClick={() => onAlways(g)}
                style={{ color: "var(--t-accent)" }}
              >
                {grantLabel(g)}
              </button>
            ))}
            <button type="button" onClick={() => setEditing(true)} style={{ color: "var(--t-text-secondary)" }}>Edit</button>
            <button type="button" onClick={() => setRejecting(true)} style={{ color: "var(--t-status-error)" }}>Reject</button>
          </>
        )}
      </div>
    </div>
  );
}
