import { useState } from "react";
import { Icon } from "@iconify/react";
import { useT } from "../useT";
import { useAgentStore } from "../state/agentStore";
import { canPreAuthorize, type PlanEntryStep, type PlanOutcome, type PlanStep } from "../state/planTokens";
import { ObjectRefChip } from "./ObjectRefChip";
import { useConnectionLabels } from "./useConnectionLabels";
import { useObjectRefs } from "./useObjectRefs";

export interface PlanEntry {
  planId: string;
  steps: PlanEntryStep[];
  outcome: PlanOutcome;
}

const stripStatus = (s: PlanEntryStep): PlanStep => {
  const { status: _status, ...rest } = s;
  return rest;
};

const PLAN_BTN = "rounded-md px-2 py-1 text-[11px] font-medium border cursor-pointer";
const PLAN_PRIMARY = `${PLAN_BTN} bg-(--t-accent) text-[color:var(--t-on-accent,#fff)] border-transparent`;
const PLAN_SECONDARY = `${PLAN_BTN} bg-transparent text-(--t-accent) border-[color:color-mix(in_srgb,var(--t-accent)_45%,transparent)]`;
const PLAN_QUIET_DANGER = `${PLAN_BTN} ml-auto bg-transparent text-(--t-status-error) border-transparent`;

export function PlanCard({ entry }: { entry: PlanEntry }) {
  const { t, tCount } = useT();
  const pendingPlan = useAgentStore((s) => s.pendingPlan);
  const resolvePlan = useAgentStore((s) => s.resolvePlan);
  const labelFor = useConnectionLabels();
  const refs = useObjectRefs();
  const connChip = (id: string) => <ObjectRefChip id={id} refObj={refs.resolve(id)} />;

  // Interactive ONLY while this entry is the live pending plan. A restored
  // entry can never satisfy this: `pendingPlan` is not persisted, and
  // deserialization has already rewritten its outcome away from "pending".
  // Two independent guards, deliberately.
  const live = pendingPlan?.planId === entry.planId && entry.outcome === "pending";

  const [steps, setSteps] = useState<PlanEntryStep[]>(entry.steps);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hintId, setHintId] = useState<string | null>(null);
  const rows = live ? steps : entry.steps;
  const empty = live && rows.length === 0;

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
          {tCount("aiAgent.plan.heading", rows.length)}
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
                  <span className="text-(--t-text-secondary) inline-flex items-center gap-1">
                    {t("aiAgent.plan.onConnectionLabel")} {connChip(s.connectionId)}
                  </span>
                </>
              ) : (
                <span className="text-(--t-text-bright) inline-flex items-center gap-1">
                  {t(`aiAgent.plan.tool.${s.tool}`)} {connChip(s.connectionId)}
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
              // A `title` alone reaches neither touch nor most keyboard users,
              // so the explanation is a disclosure the badge itself toggles.
              <div style={{ marginLeft: 20, color: "var(--t-status-warning)", fontSize: 11 }}>
                <button
                  type="button"
                  onClick={() => setHintId(hintId === s.id ? null : s.id)}
                  aria-expanded={hintId === s.id}
                  title={t("aiAgent.plan.willStillAskHint")}
                  style={{ color: "inherit", textAlign: "left" }}
                >
                  <span aria-hidden="true">⚠ </span>
                  <span>{t("aiAgent.plan.willStillAsk")}</span>
                </button>
                {hintId === s.id && (
                  <div className="text-(--t-text-dim)">{t("aiAgent.plan.willStillAskHint")}</div>
                )}
              </div>
            )}
            <div style={{ marginLeft: 20, color: "var(--t-text-dim)", fontSize: 11 }}>{s.rationale}</div>
          </div>
        );
      })}

      {live ? (
        <div className="flex gap-1.5 flex-wrap items-center">
          {/* Removing every step leaves nothing to authorize, so approving
              would silently drop out of plan mode having granted nothing.
              Reject stays enabled — it is the only meaningful exit. */}
          {empty && <span className="text-(--t-text-dim) text-[11px]">{t("aiAgent.plan.emptyHint")}</span>}
          {/* The two grades differ only in whether each step still raises its
              own card, which the labels alone do not convey — the outcome
              strings spell it out, so they double as the tooltips. */}
          <button
            type="button"
            onClick={() => approve("run")}
            disabled={empty}
            title={t("aiAgent.plan.outcome.approved_run")}
            className={`${PLAN_PRIMARY} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {t("aiAgent.plan.approveAndRun")}
          </button>
          <button
            type="button"
            onClick={() => approve("ask")}
            disabled={empty}
            title={t("aiAgent.plan.outcome.approved_ask")}
            className={`${PLAN_SECONDARY} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {t("aiAgent.plan.approvePlan")}
          </button>
          <button
            type="button"
            onClick={() => resolvePlan(entry.planId, { approve: false })}
            className={PLAN_QUIET_DANGER}
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
