import { useEffect, useState, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { useUIStore } from "@/stores/uiStore";
import { BaseCard } from "@/components/shared/BaseCard";
import { getPfState, closePfTunnel } from "@/services/portForwardingTunnels";
import type { ActiveTunnel } from "@/types";

interface PfStatePayload {
  session_id: string;
  tunnels: ActiveTunnel[];
  suppressed_ports: number[];
}

export function ActiveTunnelsSection() {
  const sessions = useSessionStore((s) => s.sessions);
  const connections = useConnectionStore((s) => s.connections);
  const accessibleVaultIds = useAccessibleVaultIds();
  const layoutMode = useUIStore((s) => s.portForwardingLayoutMode);

  const [tunnelMap, setTunnelMap] = useState<Map<string, ActiveTunnel[]>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const relevantSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (s.type !== "ssh" || s.status !== "connected") return false;
      const conn = connections.find((c) => c.id === s.connectionId);
      if (!conn) return false;
      return accessibleVaultIds.includes(conn.vault_id ?? "personal");
    });
  }, [sessions, connections, accessibleVaultIds]);

  const sessionIdKey = relevantSessions.map((s) => s.id).join(",");

  useEffect(() => {
    const ids = relevantSessions.map((s) => s.id);

    for (const sessionId of ids) {
      getPfState(sessionId)
        .then((state) => {
          setTunnelMap((prev) => new Map(prev).set(sessionId, state.tunnels));
        })
        .catch(() => {});
    }

    setTunnelMap((prev) => {
      const next = new Map(prev);
      for (const key of next.keys()) {
        if (!ids.includes(key)) next.delete(key);
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdKey]);

  useEffect(() => {
    const ids = relevantSessions.map((s) => s.id);
    let cleanup: (() => void) | undefined;

    listen<PfStatePayload>("pf-state-changed", ({ payload }) => {
      if (!ids.includes(payload.session_id)) return;
      setTunnelMap((prev) => new Map(prev).set(payload.session_id, payload.tunnels));
    }).then((u) => { cleanup = u; });

    return () => { cleanup?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdKey]);

  const ephemeralRows = useMemo(() => {
    const rows: Array<{ sessionId: string; sessionName: string; tunnel: ActiveTunnel }> = [];
    for (const session of relevantSessions) {
      for (const tunnel of tunnelMap.get(session.id) ?? []) {
        if (tunnel.origin.type !== "rule") {
          rows.push({ sessionId: session.id, sessionName: session.connectionName, tunnel });
        }
      }
    }
    return rows;
  }, [relevantSessions, tunnelMap]);

  if (ephemeralRows.length === 0) return null;

  const showSession = relevantSessions.length > 1;

  function setBusyKey(key: string, on: boolean) {
    setBusy((prev) => { const s = new Set(prev); on ? s.add(key) : s.delete(key); return s; });
  }

  async function handleStop(sessionId: string, tunnelId: string) {
    const key = `${sessionId}-${tunnelId}`;
    setBusyKey(key, true);
    try { await closePfTunnel(sessionId, tunnelId); }
    catch (e) { console.error("pf_tunnel_close failed:", e); }
    finally { setBusyKey(key, false); }
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--t-text-dim)]">
          Active
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--t-bg-elevated)] text-[var(--t-text-muted)] leading-none">
          {ephemeralRows.length}
        </span>
      </div>

      <div className={layoutMode === "grid"
        ? "grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 px-4"
        : "flex flex-col gap-1 px-4"
      }>
        {ephemeralRows.map(({ sessionId, sessionName, tunnel }) => {
          const key = `${sessionId}-${tunnel.id}`;
          const isBusy = busy.has(key);
          const isAuto = tunnel.origin.type === "auto";
          const isList = layoutMode === "list";
          const badge = (
            <span className={`text-[10px] px-1 py-0.5 rounded font-medium shrink-0 leading-none ${
              isAuto ? "bg-purple-500/20 text-purple-400" : "bg-[var(--t-bg-subtle)] text-[var(--t-text-muted)]"
            }`}>
              {isAuto ? "Auto" : "Ad-hoc"}
            </span>
          );
          const portLabel = `${tunnel.local_port} → ${tunnel.remote_host}:${tunnel.remote_port}`;
          const stopBtn = (
            <button
              onClick={(e) => { e.stopPropagation(); void handleStop(sessionId, tunnel.id); }}
              disabled={isBusy}
              title="Stop forwarding"
              className="w-6 h-6 flex items-center justify-center rounded shrink-0
                text-[var(--t-text-muted)] hover:text-amber-400 hover:bg-amber-500/10
                opacity-0 group-hover:opacity-100 transition-all"
            >
              {isBusy
                ? <Icon icon="lucide:loader-circle" width={12} className="animate-spin" />
                : <Icon icon="lucide:square" width={12} />
              }
            </button>
          );
          return (
            <BaseCard key={key} isList={isList}>
              <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />

              {isList ? (
                <>
                  <p className="text-sm font-medium truncate text-[var(--t-text-bright)]">
                    Port {tunnel.remote_port}
                  </p>
                  {badge}
                  <p className="text-xs font-mono text-[var(--t-text-secondary)] flex-1 truncate">
                    {portLabel}
                  </p>
                  {showSession && (
                    <span className="text-xs text-[var(--t-text-dim)] shrink-0 truncate max-w-[8rem]">
                      {sessionName}
                    </span>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-sm font-medium truncate text-[var(--t-text-bright)]">
                      Port {tunnel.remote_port}
                    </p>
                    {badge}
                  </div>
                  <p className="text-xs font-mono text-[var(--t-text-secondary)]">{portLabel}</p>
                  {showSession && (
                    <span className="text-xs text-[var(--t-text-dim)] truncate">{sessionName}</span>
                  )}
                </div>
              )}

              {stopBtn}
            </BaseCard>
          );
        })}
      </div>
    </div>
  );
}
