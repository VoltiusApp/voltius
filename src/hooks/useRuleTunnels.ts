import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectedSshPfStates } from "@/hooks/usePfStates";
import { closePfTunnel } from "@/services/portForwardingTunnels";
import { useRuleStartErrors } from "@/hooks/useRuleStartErrors";
import { getLocalTunnelHttpUrl } from "@/utils/tunnelFormat";
import type { ActiveTunnel, PortForwardingRule, TerminalSession } from "@/types";

export interface RuleTunnelState {
  sessionId: string;
  tunnel: ActiveTunnel;
}

export interface RuleStatus {
  status: "active" | "error" | "inactive";
  isActive: boolean;
  statusLabel: string;
  isBusy: boolean;
  webUrl: string | null;
}

export function useRuleTunnels(): {
  ruleTunnelState: Map<string, RuleTunnelState>;
  busyRuleIds: Set<string>;
  relevantSessions: TerminalSession[];
  runningRuleCount: { active: number; error: number };
  pickSessionForRule: (rule: PortForwardingRule) => TerminalSession | null;
  statusFor: (rule: PortForwardingRule) => RuleStatus;
  startRule: (rule: PortForwardingRule) => Promise<void>;
  stopRule: (rule: PortForwardingRule) => Promise<void>;
} {
  const { t } = useTranslation();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const { sessions: relevantSessions, pfStates } = useConnectedSshPfStates();

  const [busyRuleIds, setBusyRuleIds] = useState<Set<string>>(new Set());
  const { errorFor, startRuleOn } = useRuleStartErrors();

  function setRuleBusy(id: string, on: boolean) {
    setBusyRuleIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const ruleTunnelState = useMemo(() => {
    const result = new Map<string, RuleTunnelState>();
    for (const [sessionId, { tunnels }] of pfStates) {
      for (const tunnel of tunnels) {
        if (tunnel.origin.type === "rule") result.set(tunnel.origin.rule_id, { sessionId, tunnel });
      }
    }
    return result;
  }, [pfStates]);

  const runningRuleCount = useMemo(() => {
    let active = 0;
    let error = 0;
    for (const { tunnel } of ruleTunnelState.values()) {
      if (typeof tunnel.state === "object" && "error" in tunnel.state) error += 1;
      else active += 1;
    }
    return { active, error };
  }, [ruleTunnelState]);

  function pickSessionForRule(rule: PortForwardingRule) {
    const active = relevantSessions.find((s) => s.id === activeSessionId);
    if (active && (rule.connection_ids.length === 0 || rule.connection_ids.includes(active.connectionId))) return active;
    return relevantSessions.find((s) => rule.connection_ids.length === 0 || rule.connection_ids.includes(s.connectionId)) ?? null;
  }

  function statusFor(rule: PortForwardingRule): RuleStatus {
    const activeState = ruleTunnelState.get(rule.id);
    const tunnel = activeState?.tunnel;
    const errorLabel = errorFor(rule.id, tunnel);
    const isError = errorLabel !== undefined;
    const status = isError ? "error" : tunnel ? "active" : "inactive";
    const webUrl = tunnel && !isError
      ? getLocalTunnelHttpUrl(rule.tunnel_type ?? "local", rule.remote_port, tunnel.local_port, tunnel.bind_host)
      : null;
    return {
      status,
      isActive: status === "active",
      statusLabel: errorLabel ?? (status === "active" ? t("portForwarding.ruleCard.active") : pickSessionForRule(rule) ? t("portForwarding.ruleCard.stopped") : t("portForwarding.ruleCard.noSshSession")),
      isBusy: busyRuleIds.has(rule.id),
      webUrl,
    };
  }

  async function startRule(rule: PortForwardingRule) {
    const session = pickSessionForRule(rule);
    if (!session) return;
    setRuleBusy(rule.id, true);
    await startRuleOn(session.id, rule);
    setRuleBusy(rule.id, false);
  }

  async function stopRule(rule: PortForwardingRule) {
    const state = ruleTunnelState.get(rule.id);
    if (!state) return;
    setRuleBusy(rule.id, true);
    try { await closePfTunnel(state.sessionId, state.tunnel.id); }
    catch (e) { console.error("pf_tunnel_close failed:", e); }
    finally { setRuleBusy(rule.id, false); }
  }

  return {
    ruleTunnelState,
    busyRuleIds,
    relevantSessions,
    runningRuleCount,
    pickSessionForRule,
    statusFor,
    startRule,
    stopRule,
  };
}
