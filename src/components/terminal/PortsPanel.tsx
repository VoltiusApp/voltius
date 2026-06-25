import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Icon } from "@iconify/react";
import { PortRow } from "@/components/terminal/PortRow";
import { QuickForwardRow } from "@/components/terminal/QuickForwardRow";
import { useSessionStore } from "@/stores/sessionStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useAllPortForwardingRules } from "@/hooks/useAllPortForwardingRules";
import {
  getPfState,
  openPfTunnel,
  closePfTunnel,
  resumeAutoPort,
} from "@/services/portForwardingTunnels";
import { createPfRule, updatePfRule, deletePfRule } from "@/services/portForwardingRules";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { formatActiveTunnelLabel, formatRuleLabel, getLocalTunnelHttpUrl } from "@/utils/tunnelFormat";
import type { ActiveTunnel, PortForwardingRule } from "@/types";

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

  const quickForwardInputRef = useRef<HTMLInputElement>(null);
  const defaultVaultId = useDefaultVaultId();
  const [renamingRuleId, setRenamingRuleId] = useState<string | null>(null);

  async function handleSaveAsRule(tunnel: ActiveTunnel) {
    if (!activeSessionId) return;
    const key = `save-${tunnel.id}`;
    setBusyKey(key, true);
    try {
      const defaultName = `Port ${tunnel.remote_port}`;
      const rule = await createPfRule({
        name: defaultName,
        local_port: tunnel.local_port,
        remote_port: tunnel.remote_port,
        remote_host: tunnel.remote_host || "127.0.0.1",
        tunnel_type: "local",
        bind_host: "127.0.0.1",
        target_host: "127.0.0.1",
        connection_ids: activeSession?.connectionId ? [activeSession.connectionId] : [],
        vault_id: resolveVaultIdForSave(defaultVaultId),
      });
      await loadRules();
      // Re-open the running tunnel as rule-backed so it migrates ACTIVE → SAVED.
      await closePfTunnel(activeSessionId, tunnel.id);
      await openPfTunnel({
        sessionId: activeSessionId,
        localPort: tunnel.local_port,
        remotePort: tunnel.remote_port,
        remoteHost: tunnel.remote_host,
        tunnelType: "local",
        ruleId: rule.id,
        ruleName: rule.name,
      });
      setRenamingRuleId(rule.id);
    } catch (e) {
      console.error("save as rule failed:", e);
    } finally {
      setBusyKey(key, false);
    }
  }

  async function commitRename(ruleId: string, name: string) {
    setRenamingRuleId(null);
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule || name === rule.name) return;
    try {
      await updatePfRule(ruleId, {
        name,
        local_port: rule.local_port,
        remote_port: rule.remote_port,
        remote_host: rule.remote_host,
        tunnel_type: rule.tunnel_type,
        bind_host: rule.bind_host,
        target_host: rule.target_host,
        description: rule.description,
        connection_ids: rule.connection_ids,
        folder_id: rule.folder_id,
        vault_id: rule.vault_id,
      });
      await loadRules();
    } catch (e) {
      console.error("rename rule failed:", e);
    }
  }

  async function handleQuickForward(remotePort: number, localPort?: number) {
    if (!activeSessionId) return;
    await openPfTunnel({
      sessionId: activeSessionId,
      remotePort,
      localPort: localPort ?? remotePort,
      tunnelType: "local",
    });
  }

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
      <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center text-(--t-text-dim)">
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
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto">
      {isEmpty && (
        <div className="px-3 py-4 text-xs text-(--t-text-dim)">
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
            localPort={tunnel?.local_port}
            httpUrl={isActive && !isError && tunnel
              ? getLocalTunnelHttpUrl(rule.tunnel_type ?? "local", rule.remote_port, tunnel.local_port)
              : null}
            onToggle={() => isActive ? handleRuleDisable(tunnel!.id, rule.id) : handleRuleEnable(rule)}
            onDelete={() => handleRuleDelete(rule, tunnel)}
            isRenaming={renamingRuleId === rule.id}
            defaultName={rule.name}
            onRenameCommit={(name) => commitRename(rule.id, name)}
            onRenameCancel={() => setRenamingRuleId(null)}
          />
        );
      })}

      {/* Active auto/adhoc tunnels + suppressed auto ports */}
      {(visibleUnclaimed.length > 0 || suppressedRows.length > 0) && (
        <>
          {rules.length > 0 && <div className="border-t border-(--t-border) mx-2 my-0.5" />}

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
                localPort={tunnel.local_port}
                httpUrl={getLocalTunnelHttpUrl(tunnel.tunnel_type ?? "local", tunnel.remote_port, tunnel.local_port)}
                onToggle={() => handleTunnelStop(tunnel.id, key)}
                onDelete={() => handleTunnelDelete(tunnel.id, tunnel.remote_port, key)}
                onSaveAsRule={() => handleSaveAsRule(tunnel)}
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
      <QuickForwardRow inputRef={quickForwardInputRef} onSubmit={handleQuickForward} />
    </div>
  );
}

