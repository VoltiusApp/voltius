import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "../state/agentStore";
import { scopeLabelText } from "../state/connectionLabels";
import { canPreAuthorize, type PlanEntryStep, type PlanOutcome, type PlanStep } from "../state/planTokens";
import { useConnectionLabels } from "./useConnectionLabels";

export interface PlanEntry {
  planId: string;
  steps: PlanEntryStep[];
  outcome: PlanOutcome;
}

const stripStatus = (s: PlanEntryStep): PlanStep => {
  const { status: _status, ...rest } = s;
  return rest;
};

export function PlanCard({ entry }: { entry: PlanEntry }) {
  const { t } = useTranslation();
  const pendingPlan = useAgentStore((s) => s.pendingPlan);
  const resolvePlan = useAgentStore((s) => s.resolvePlan);
  const labelFor = useConnectionLabels();

  // Interactive ONLY while this entry is the live pending plan. A restored
  // entry can never satisfy this: `pendingPlan` is not persisted, and
  // deserialization has already rewritten its outcome away from "pending".
  // Two independent guards, deliberately.
  const live = pendingPlan?.planId === entry.planId && entry.outcome === "pending";

  const [steps, setSteps] = useState<PlanEntryStep[]>(entry.steps);
  const [editingId, setEditingId] = useState<string | null>(null);
  const rows = live ? steps : entry.steps;

  const connText = (id: string) => scopeLabelText(labelFor(id), t);
  const setCommand = (id: string, command: string) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, command } : s)));

  const approve = (approval: "run" | "ask") =>
    resolvePlan(entry.planId, { approve: approval, steps: steps.map(stripStatus) });

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
        opacity: live ? 1 : 0.85,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon icon="lucide:list-checks" width={14} style={{ color: "var(--t-accent)" }} />
        <span style={{ color: "var(--t-text-bright)", fontWeight: 600 }}>
          {t("aiAgent.plan.heading", { count: rows.length })}
        </span>
        <span style={{ marginLeft: "auto", color: "var(--t-text-secondary)", fontSize: 11 }}>
          {t(`aiAgent.plan.outcome.${entry.outcome}`)}
        </span>
      </div>

      {rows.map((s, i) => {
        // A step can be pre-authorizable in principle (`canPreAuthorize`) yet
        // name a connection that doesn't exist — a hallucinated or stale id.
        // `mintTokens` still mints a token for it, but `deriveScope` returns
        // null at execution, so the token can never match: the step WILL
        // raise a card. The badge must say so.
        //
        // `pending` (the connection list hasn't loaded yet) is deliberately
        // treated as resolved-for-now, not unresolvable: flashing the badge
        // on for every step on first render and then clearing it a moment
        // later would be a louder lie than the badge simply arriving a beat
        // late for the rare hallucinated-id case.
        const connKind = labelFor(s.connectionId).kind;
        const unresolvedConnection = connKind !== "connection" && connKind !== "pending";
        const badge = live && (!canPreAuthorize(stripStatus(s)) || unresolvedConnection);
        return (
          <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ color: "var(--t-text-dim)", minWidth: 14 }}>{i + 1}</span>
              {s.tool === "run_command" ? (
                <>
                  <span style={{ color: "var(--t-text-secondary)" }}>{t("aiAgent.plan.tool.run_command")}</span>
                  {live && editingId === s.id ? (
                    <input
                      value={s.command ?? ""}
                      onChange={(e) => setCommand(s.id, e.target.value)}
                      style={{
                        flex: 1, minWidth: 120, background: "var(--t-bg-modal)",
                        border: "1px solid var(--t-border)", color: "var(--t-text-bright)",
                        borderRadius: 4, padding: "2px 6px",
                      }}
                    />
                  ) : (
                    <code
                      style={{
                        color: "var(--t-text-bright)",
                        wordBreak: "break-all",
                        whiteSpace: "pre-wrap",
                        unicodeBidi: "isolate",
                      }}
                    >
                      {s.command}
                    </code>
                  )}
                  <span style={{ color: "var(--t-text-secondary)" }}>
                    {t("aiAgent.plan.onConnection", { connection: connText(s.connectionId) })}
                  </span>
                </>
              ) : (
                <span style={{ color: "var(--t-text-bright)" }}>
                  {t(`aiAgent.plan.tool.${s.tool}`, { connection: connText(s.connectionId) })}
                </span>
              )}

              {live ? (
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {s.tool === "run_command" && (
                    <button
                      type="button"
                      onClick={() => setEditingId(editingId === s.id ? null : s.id)}
                      style={{ color: "var(--t-text-secondary)" }}
                    >
                      {t("aiAgent.plan.edit")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSteps((prev) => prev.filter((x) => x.id !== s.id))}
                    style={{ color: "var(--t-status-error)" }}
                  >
                    {t("aiAgent.plan.remove")}
                  </button>
                </span>
              ) : (
                <span style={{ marginLeft: "auto", color: "var(--t-text-dim)", fontSize: 11 }}>
                  {t(`aiAgent.plan.status.${s.status}`)}
                </span>
              )}
            </div>

            {badge && (
              <div
                title={t("aiAgent.plan.willStillAskHint")}
                style={{ marginLeft: 20, color: "var(--t-status-warning)", fontSize: 11 }}
              >
                <span aria-hidden="true">⚠ </span>
                <span>{t("aiAgent.plan.willStillAsk")}</span>
              </div>
            )}
            <div style={{ marginLeft: 20, color: "var(--t-text-dim)", fontSize: 11 }}>{s.rationale}</div>
          </div>
        );
      })}

      {live ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" onClick={() => approve("run")} style={{ color: "var(--t-status-connected)" }}>
            {t("aiAgent.plan.approveAndRun")}
          </button>
          <button type="button" onClick={() => approve("ask")} style={{ color: "var(--t-accent)" }}>
            {t("aiAgent.plan.approvePlan")}
          </button>
          <button
            type="button"
            onClick={() => resolvePlan(entry.planId, { approve: false })}
            style={{ color: "var(--t-status-error)" }}
          >
            {t("aiAgent.plan.reject")}
          </button>
        </div>
      ) : (
        entry.outcome === "abandoned" && (
          <div style={{ color: "var(--t-text-dim)", fontSize: 11 }}>{t("aiAgent.plan.expired")}</div>
        )
      )}
    </div>
  );
}
