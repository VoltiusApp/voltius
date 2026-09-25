import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/sessionStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { usePfStates } from "@/hooks/usePfStates";
import { openPfTunnel, closePfTunnel } from "@/services/portForwardingTunnels";
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
  const { sessions, activeSessionId } = useSessionStore();
  const connections = useAllConnections();
  const accessibleVaultIds = useAccessibleVaultIds();

  const [busyRuleIds, setBusyRuleIds] = useState<Set<string>>(new Set());

  const relevantSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (s.type !== "ssh" || s.status !== "connected") return false;
      const conn = connections.find((c) => c.id === s.connectionId);
      if (!conn) return false;
      return accessibleVaultIds.includes(conn.vault_id ?? "personal");
    });
  }, [sessions, connections, accessibleVaultIds]);

  const pfStates = usePfStates(relevantSessions.map((s) => s.id));

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
    const isError = tunnel ? typeof tunnel.state === "object" && "error" in tunnel.state : false;
    const status = tunnel ? (isError ? "error" : "active") : "inactive";
    const errorLabel = tunnel && isError ? (tunnel.state as { error: string }).error : undefined;
    const webUrl = tunnel && !isError
      ? getLocalTunnelHttpUrl(rule.tunnel_type ?? "local", rule.remote_port, tunnel.local_port)
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
    try {
      await openPfTunnel({
        sessionId: session.id,
        localPort: rule.local_port,
        remotePort: rule.remote_port,
        remoteHost: rule.remote_host,
        tunnelType: rule.tunnel_type ?? "local",
        bindHost: rule.bind_host ?? "127.0.0.1",
        targetHost: rule.target_host ?? "127.0.0.1",
        ruleId: rule.id,
        ruleName: rule.name,
      });
    } catch (e) { console.error("pf_tunnel_open failed:", e); }
    finally { setRuleBusy(rule.id, false); }
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
