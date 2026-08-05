import { useState } from "react";
import { Icon } from "@iconify/react";
import { useT } from "../useT";
import { useAgentStore, type PendingApproval } from "../state/agentStore";
import type { AllowlistEntry } from "../state/allowlist";
import { scopeLabelText } from "../state/connectionLabels";
import { useConnectionLabels } from "./useConnectionLabels";
import { ObjectRefCard } from "./ObjectRefCard";
import { useObjectRefs } from "./useObjectRefs";

export function ApprovalCard({ pending }: { pending: PendingApproval }) {
  const { t } = useT();
  const resolveApproval = useAgentStore((s) => s.resolveApproval);
  const addAllowlist = useAgentStore((s) => s.addAllowlist);
  const labelFor = useConnectionLabels();
  const refs = useObjectRefs();

  const [editing, setEditing] = useState(false);
  const [command, setCommand] = useState(String(pending.args.command ?? ""));
  const [connectionId, setConnectionId] = useState(String(pending.args.connectionId ?? ""));
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const scopeLabel = labelFor(pending.scope);
  const scopeText = scopeLabelText(scopeLabel, t);
  const hasConnectionId = "connectionId" in pending.args;
  const hasCommand = "command" in pending.args;
  const targetId = String(pending.args.connectionId ?? "");
  // `close_session` (and any future tool with neither `command` nor
  // `connectionId` in its args) still gets `pending.scope` set by
  // `deriveScope` — for close_session that's the connection the target
  // session belongs to. Resolve it so the fallback branch below can show a
  // real connection card instead of a raw id or a JSON dump of args.
  const scopeRef = refs.resolve(pending.scope);

  const grantLabel = (g: AllowlistEntry) =>
    g.grain === "exact"
      ? t("aiAgent.approval.always.exact", { command: g.key, connection: scopeText })
      : t("aiAgent.approval.always.tool", { tool: g.tool, connection: scopeText });

  const onApprove = () => resolveApproval(pending.id, { approve: true, scope: pending.scope, via: "prompted" });
  const onAlways = (g: AllowlistEntry) => {
    addAllowlist(g);
    resolveApproval(pending.id, { approve: true, scope: pending.scope, via: "prompted" });
  };
  const onSaveEdit = () => {
    const args = { ...pending.args };
    if (hasCommand) args.command = command;
    let scope = pending.scope;
    // An edited connectionId must carry through to scope: otherwise the
    // audit record would attribute this call to the originally-proposed
    // connection, not the one it actually ran on.
    if (hasConnectionId) { args.connectionId = connectionId; scope = connectionId; }
    resolveApproval(pending.id, { approve: true, scope, via: "prompted", args });
  };
  const onConfirmReject = () =>
    resolveApproval(pending.id, { approve: false, reason: reason.trim() || undefined });

  return (
    <div className="flex flex-col gap-2 rounded-lg p-2.5 text-xs bg-(--t-bg-elevated) border border-(--t-border)">
      <div className="flex items-center gap-1.5">
        <Icon icon="lucide:shield-alert" width={14} className="text-(--t-status-warning)" />
        <span className="font-semibold text-(--t-text-bright)">{pending.tool}</span>
        <span className="text-(--t-text-secondary)" title={scopeLabel.detail ?? undefined}>
          {t("aiAgent.approval.onScope", { connection: scopeText })}
        </span>
        <span className="ml-auto rounded-full px-1.5 text-[10px] text-(--t-status-warning) border border-[color:color-mix(in_srgb,var(--t-status-warning)_40%,transparent)]">
          {t("aiAgent.approval.needsApproval")}
        </span>
      </div>

      {editing ? (
        <div className="flex flex-col gap-1.5">
          {hasCommand && (
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t("aiAgent.approval.commandPlaceholder")}
              className="rounded px-1.5 py-1 bg-(--t-bg-modal) border border-(--t-border) text-(--t-text-bright)"
            />
          )}
          {hasConnectionId && (
            <input
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              placeholder={t("aiAgent.approval.connectionIdPlaceholder")}
              className="rounded px-1.5 py-1 bg-(--t-bg-modal) border border-(--t-border) text-(--t-text-bright)"
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {hasCommand && (
            <code className="whitespace-pre-wrap break-all text-(--t-text-secondary)">{command}</code>
          )}
          {hasConnectionId && <ObjectRefCard id={targetId} refObj={refs.resolve(targetId)} />}
          {!hasCommand && !hasConnectionId && (
            scopeRef ? (
              <ObjectRefCard id={pending.scope} refObj={scopeRef} />
            ) : (
              <span className="text-(--t-text-secondary)">{t("aiAgent.approval.noDetail")}</span>
            )
          )}
        </div>
      )}

      {rejecting && (
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("aiAgent.approval.reasonPlaceholder")}
          className="rounded px-1.5 py-1 bg-(--t-bg-modal) border border-(--t-border) text-(--t-text-bright)"
        />
      )}

      <div className="flex gap-1.5 flex-wrap">
        {editing ? (
          <>
            <button type="button" onClick={onSaveEdit} className="text-(--t-status-connected)">{t("aiAgent.approval.saveApprove")}</button>
            <button type="button" onClick={() => setEditing(false)} className="text-(--t-text-secondary)">{t("aiAgent.approval.cancel")}</button>
          </>
        ) : rejecting ? (
          <>
            <button type="button" onClick={onConfirmReject} className="text-(--t-status-error)">{t("aiAgent.approval.confirmReject")}</button>
            <button type="button" onClick={() => setRejecting(false)} className="text-(--t-text-secondary)">{t("aiAgent.approval.cancel")}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={onApprove} className="text-(--t-status-connected)">{t("aiAgent.approval.approve")}</button>
            {pending.grants.map((g) => (
              <button key={`${g.grain}:${g.key}`} type="button" onClick={() => onAlways(g)} className="text-(--t-accent)">
                {grantLabel(g)}
              </button>
            ))}
            <button type="button" onClick={() => setEditing(true)} className="text-(--t-text-secondary)">{t("aiAgent.approval.edit")}</button>
            <button type="button" onClick={() => setRejecting(true)} className="text-(--t-status-error)">{t("aiAgent.approval.reject")}</button>
          </>
        )}
      </div>
    </div>
  );
}
