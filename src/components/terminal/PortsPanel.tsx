import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useAllPortForwardingRules } from "@/hooks/useAllPortForwardingRules";
import {
  getPfState,
  openPfTunnel,
  closePfTunnel,
  resumeAutoPort,
} from "@/services/portForwardingTunnels";
import { deletePfRule } from "@/services/portForwardingRules";
import { formatActiveTunnelLabel, formatRuleLabel, getLocalTunnelHttpUrl } from "@/utils/tunnelFormat";
import type { ActiveTunnel, PortForwardingRule } from "@/types";

function formatBytes(b: number): string {
  if (b === 0) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

interface PfStatePayload {
  session_id: string;
  tunnels: ActiveTunnel[];
  suppressed_ports: number[];
}

export function PortsPanel() {
  const { sessions, activeSessionId } = useSessionStore();
  const loadRules = usePortForwardingStore((s) => s.loadRules);
  const rules = useAllPortForwardingRules();
  const [tunnels, setTunnels] = useState<ActiveTunnel[]>([]);
  const [suppressedPorts, setSuppressedPorts] = useState<number[]>([]);
  // Ports the user deleted from this panel — hidden even when suppressed
  const [hiddenPorts, setHiddenPorts] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isSshSession = activeSession?.type === "ssh";

  useEffect(() => { loadRules(); }, []);

  useEffect(() => {
    if (!activeSessionId || !isSshSession) {
      setTunnels([]);
      setSuppressedPorts([]);
      setHiddenPorts(new Set());
      return;
    }

    getPfState(activeSessionId)
      .then((s) => { setTunnels(s.tunnels); setSuppressedPorts(s.suppressed_ports); })
      .catch(() => {});

    let cleanup: (() => void) | undefined;
    listen<PfStatePayload>("pf-state-changed", ({ payload }) => {
      if (payload.session_id === activeSessionId) {
        setTunnels(payload.tunnels);
        setSuppressedPorts(payload.suppressed_ports);
      }
    }).then((u) => { cleanup = u; });

    return () => { cleanup?.(); };
  }, [activeSessionId, isSshSession]);

  function setBusyKey(key: string, on: boolean) {
    setBusy((prev) => { const s = new Set(prev); on ? s.add(key) : s.delete(key); return s; });
  }

  // ── Rule actions ──────────────────────────────────────────────────────────

  async function handleRuleEnable(rule: PortForwardingRule) {
    if (!activeSessionId) return;
    setBusyKey(rule.id, true);
    try {
      await openPfTunnel({
        sessionId: activeSessionId,
        localPort: rule.local_port,
        remotePort: rule.remote_port,
        remoteHost: rule.remote_host,
        tunnelType: rule.tunnel_type,
        bindHost: rule.bind_host,
        targetHost: rule.target_host,
        ruleId: rule.id,
        ruleName: rule.name,
      });
    } catch (e) { console.error("pf_tunnel_open failed:", e); }
    finally { setBusyKey(rule.id, false); }
  }

  async function handleRuleDisable(tunnelId: string, ruleId: string) {
    if (!activeSessionId) return;
    setBusyKey(ruleId, true);
    try { await closePfTunnel(activeSessionId, tunnelId); }
    catch (e) { console.error("pf_tunnel_close failed:", e); }
    finally { setBusyKey(ruleId, false); }
  }

  async function handleRuleDelete(rule: PortForwardingRule, activeTunnel?: ActiveTunnel) {
    if (!activeSessionId) return;
    setBusyKey(`del-${rule.id}`, true);
    try {
      if (activeTunnel) await closePfTunnel(activeSessionId, activeTunnel.id);
      await deletePfRule(rule.id);
      await loadRules();
    } catch (e) { console.error("rule delete failed:", e); }
    finally { setBusyKey(`del-${rule.id}`, false); }
  }

  // ── Auto/adhoc tunnel actions ──────────────────────────────────────────────

  async function handleAutoResume(port: number) {
    if (!activeSessionId) return;
    setBusyKey(`port-${port}`, true);
    try { await resumeAutoPort(activeSessionId, port); }
    catch (e) { console.error("pf_tunnel_resume_auto failed:", e); }
    finally { setBusyKey(`port-${port}`, false); }
  }

  async function handleTunnelStop(tunnelId: string, key: string) {
    if (!activeSessionId) return;
    setBusyKey(key, true);
    try { await closePfTunnel(activeSessionId, tunnelId); }
    catch (e) { console.error("pf_tunnel_close failed:", e); }
    finally { setBusyKey(key, false); }
  }

  async function handleTunnelDelete(tunnelId: string, port: number, key: string) {
    if (!activeSessionId) return;
    setBusyKey(`del-${key}`, true);
    try {
      await closePfTunnel(activeSessionId, tunnelId);
      setHiddenPorts((prev) => new Set([...prev, port]));
    } catch (e) { console.error("pf_tunnel_close failed:", e); }
    finally { setBusyKey(`del-${key}`, false); }
  }

  function handleSuppressedDelete(port: number) {
    setHiddenPorts((prev) => new Set([...prev, port]));
  }

  if (!isSshSession) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center text-[var(--t-text-dim)]">
        <Icon icon="lucide:network" width={24} />
        <span className="text-xs">Port forwarding requires an SSH session.</span>
      </div>
    );
  }

  // Build lookup: rule_id → active tunnel
  const ruleToTunnel = new Map<string, ActiveTunnel>();
  const unclaimedTunnels: ActiveTunnel[] = [];
  for (const t of tunnels) {
    if (t.origin.type === "rule") ruleToTunnel.set(t.origin.rule_id, t);
    else unclaimedTunnels.push(t);
  }

  const rulePorts = new Set(rules.map((r) => r.remote_port));
  const suppressedRows = suppressedPorts.filter(
    (p) => !rulePorts.has(p) && !hiddenPorts.has(p),
  );
  const visibleUnclaimed = unclaimedTunnels.filter((t) => !hiddenPorts.has(t.remote_port));

  const isEmpty = rules.length === 0 && visibleUnclaimed.length === 0 && suppressedRows.length === 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {isEmpty && (
        <div className="px-3 py-4 text-xs text-[var(--t-text-dim)]">
          No forwarded ports. Ports detected on the remote host will appear here automatically.
        </div>
      )}

      {/* Saved rules */}
      {rules.map((rule) => {
        const tunnel = ruleToTunnel.get(rule.id);
        const isActive = !!tunnel;
        const isError = tunnel && typeof tunnel.state === "object" && "error" in tunnel.state;
        return (
          <PortRow
            key={rule.id}
            label={rule.name}
            portInfo={formatRuleLabel(rule)}
            isActive={isActive && !isError}
            isError={!!isError}
            isBusy={busy.has(rule.id)}
            isDeleting={busy.has(`del-${rule.id}`)}
            badge={null}
            bytesTransferred={tunnel?.bytes_transferred}
            httpUrl={isActive && !isError && tunnel
              ? getLocalTunnelHttpUrl(rule.tunnel_type ?? "local", rule.remote_port, tunnel.local_port)
              : null}
            onToggle={() => isActive ? handleRuleDisable(tunnel!.id, rule.id) : handleRuleEnable(rule)}
            onDelete={() => handleRuleDelete(rule, tunnel)}
          />
        );
      })}

      {/* Active auto/adhoc tunnels + suppressed auto ports */}
      {(visibleUnclaimed.length > 0 || suppressedRows.length > 0) && (
        <>
          {rules.length > 0 && <div className="border-t border-[var(--t-border)] mx-2 my-0.5" />}

          {visibleUnclaimed.map((tunnel) => {
            const isAuto = tunnel.origin.type === "auto";
            const key = `unclaimed-${tunnel.id}`;
            const isError = typeof tunnel.state === "object" && "error" in tunnel.state;
            const label = tunnel.tunnel_type === "dynamic"
              ? `SOCKS5 :${tunnel.local_port}`
              : `Port ${tunnel.remote_port}`;
            return (
              <PortRow
                key={tunnel.id}
                label={label}
                portInfo={formatActiveTunnelLabel(tunnel)}
                isActive={!isError}
                isError={isError}
                isBusy={busy.has(key)}
                isDeleting={busy.has(`del-${key}`)}
                badge={isAuto ? "auto" : "adhoc"}
                bytesTransferred={tunnel.bytes_transferred}
                httpUrl={getLocalTunnelHttpUrl(tunnel.tunnel_type ?? "local", tunnel.remote_port, tunnel.local_port)}
                onToggle={() => handleTunnelStop(tunnel.id, key)}
                onDelete={() => handleTunnelDelete(tunnel.id, tunnel.remote_port, key)}
              />
            );
          })}

          {suppressedRows.map((port) => {
            const key = `port-${port}`;
            return (
              <PortRow
                key={`suppressed-${port}`}
                label={`Port ${port}`}
                portInfo={`${port} → 127.0.0.1:${port}`}
                isActive={false}
                isBusy={busy.has(key)}
                isDeleting={false}
                badge="auto"
                onToggle={() => handleAutoResume(port)}
                onDelete={() => handleSuppressedDelete(port)}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

type BadgeType = "auto" | "adhoc" | null;

function PortRow({
  label,
  portInfo,
  isActive,
  isError,
  isBusy,
  isDeleting,
  badge,
  bytesTransferred,
  httpUrl,
  onToggle,
  onDelete,
}: {
  label: string;
  portInfo: string;
  isActive: boolean;
  isError?: boolean;
  isBusy: boolean;
  isDeleting: boolean;
  badge: BadgeType;
  bytesTransferred?: number;
  httpUrl?: string | null;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const bytes = formatBytes(bytesTransferred ?? 0);
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 group hover:bg-[var(--t-bg-elevated)]">
      {/* Status dot */}
      <div className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
        isError ? "bg-red-500" : isActive ? "bg-green-500" : "bg-[var(--t-text-dim)] opacity-40"
      }`} />

      {/* Label + port info */}
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium text-[var(--t-text-primary)] truncate leading-tight">
            {label}
          </span>
          {badge && (
            <span className={`text-[10px] px-1 py-0.5 rounded font-medium shrink-0 leading-none ${
              badge === "auto"
                ? "bg-purple-500/20 text-purple-400"
                : "bg-[var(--t-bg-elevated)] text-[var(--t-text-muted)]"
            }`}>
              {badge === "auto" ? "Auto" : "Ad-hoc"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-[var(--t-text-muted)] truncate leading-tight">
            {portInfo}
          </span>
          {bytes && (
            <span className="text-[10px] text-[var(--t-text-dim)] shrink-0 leading-tight">
              {bytes}
            </span>
          )}
        </div>
      </div>

      {/* Toggle pause/resume — hover only */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        disabled={isBusy}
        title={isActive ? "Pause forwarding" : "Resume forwarding"}
        className={`w-5 h-5 flex items-center justify-center rounded shrink-0 transition-all
          opacity-0 group-hover:opacity-100
          ${isActive
            ? "text-[var(--t-text-muted)] hover:text-amber-400 hover:bg-amber-500/10"
            : "text-[var(--t-text-muted)] hover:text-green-400 hover:bg-green-500/10"
          }`}
      >
        {isBusy ? (
          <Icon icon="lucide:loader-circle" width={11} className="animate-spin" />
        ) : isActive ? (
          <Icon icon="lucide:pause" width={11} />
        ) : (
          <Icon icon="lucide:play" width={11} />
        )}
      </button>

      {/* Delete — hover only */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        disabled={isDeleting}
        title="Delete"
        className="w-5 h-5 flex items-center justify-center rounded shrink-0 transition-all
          opacity-0 group-hover:opacity-100
          text-[var(--t-text-muted)] hover:text-red-400 hover:bg-red-500/10"
      >
        {isDeleting ? (
          <Icon icon="lucide:loader-circle" width={11} className="animate-spin" />
        ) : (
          <Icon icon="lucide:trash-2" width={11} />
        )}
      </button>

      {/* Open in browser — always visible, rightmost */}
      {isActive && httpUrl && (
        <button
          onClick={(e) => { e.stopPropagation(); void openUrl(httpUrl); }}
          title={`Open ${httpUrl}`}
          className="w-5 h-5 flex items-center justify-center rounded shrink-0 transition-all
            text-[var(--t-text-muted)] hover:text-blue-400 hover:bg-blue-500/10"
        >
          <Icon icon="lucide:globe" width={11} />
        </button>
      )}
    </div>
  );
}
