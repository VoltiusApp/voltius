import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { useUIStore } from "@/stores/uiStore";
import { getPfState, closePfTunnel, resumeAutoPort } from "@/services/portForwardingTunnels";
import { formatActiveTunnelLabel, getLocalTunnelHttpUrl } from "@/utils/tunnelFormat";
import { getConnectionIcon, getConnectionIconColor } from "@/utils/icons";
import { AvatarTile } from "@/components/shared/AvatarTile";
import type { ActiveTunnel } from "@/types";

interface PfStatePayload {
  session_id: string;
  tunnels: ActiveTunnel[];
  suppressed_ports: number[];
}

interface SessionPfState {
  tunnels: ActiveTunnel[];
  suppressedPorts: number[];
}

function TunnelTypeBadge({ tunnelType }: { tunnelType: ActiveTunnel["tunnel_type"] }) {
  const { t } = useTranslation();
  if ((tunnelType ?? "local") === "local") {
    return <span className="text-[10px] px-1 py-0.5 rounded-sm font-medium shrink-0 leading-none bg-blue-500/15 text-blue-400">{t("portForwarding.activeTunnels.local")}</span>;
  }
  if (tunnelType === "remote") {
    return <span className="text-[10px] px-1 py-0.5 rounded-sm font-medium shrink-0 leading-none bg-amber-500/15 text-amber-400">{t("portForwarding.activeTunnels.remote")}</span>;
  }
  if (tunnelType === "dynamic") {
    return <span className="text-[10px] px-1 py-0.5 rounded-sm font-medium shrink-0 leading-none bg-purple-500/20 text-purple-400">{t("portForwarding.activeTunnels.socks5")}</span>;
  }
  return null;
}

export function ActiveTunnelsSection() {
  const { t } = useTranslation();
  const sessions = useSessionStore((s) => s.sessions);
  const connections = useAllConnections();
  const accessibleVaultIds = useAccessibleVaultIds();
  const layoutMode = useUIStore((s) => s.portForwardingLayoutMode);

  const [pfStateMap, setPfStateMap] = useState<Map<string, SessionPfState>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [hiddenPorts, setHiddenPorts] = useState<Set<string>>(new Set());

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
        .then((state) => setPfStateMap((prev) => new Map(prev).set(sessionId, { tunnels: state.tunnels, suppressedPorts: state.suppressed_ports })))
        .catch(() => {});
    }

    setPfStateMap((prev) => {
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
      setPfStateMap((prev) => new Map(prev).set(payload.session_id, { tunnels: payload.tunnels, suppressedPorts: payload.suppressed_ports }));
    }).then((u) => { cleanup = u; });

    return () => { cleanup?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdKey]);

  // Port forwarding is host-scoped: terminals of the same host share one tunnel
  // list, so collapse to a single card per host (first session per connection).
  const hostSessions = useMemo(() => {
    const seen = new Set<string>();
    return relevantSessions.filter((s) => {
      if (seen.has(s.connectionId)) return false;
      seen.add(s.connectionId);
      return true;
    });
  }, [relevantSessions]);

  const sessionCards = useMemo(() => {
    return hostSessions
      .map((session) => {
        const connection = connections.find((c) => c.id === session.connectionId) ?? null;
        const state = pfStateMap.get(session.id);
        const tunnels = (state?.tunnels ?? []).filter((tunnel) => tunnel.origin.type !== "rule" && !hiddenPorts.has(`${session.id}:${tunnel.remote_port}`));
        const activePorts = new Set(tunnels.map((tunnel) => tunnel.remote_port));
        const suppressedPorts = (state?.suppressedPorts ?? []).filter((port) => !activePorts.has(port) && !hiddenPorts.has(`${session.id}:${port}`));
        const errorCount = tunnels.filter((tunnel) => typeof tunnel.state === "object" && "error" in tunnel.state).length;
        return { session, connection, tunnels, suppressedPorts, errorCount };
      })
      .filter(({ tunnels, suppressedPorts }) => tunnels.length > 0 || suppressedPorts.length > 0);
  }, [hostSessions, connections, pfStateMap, hiddenPorts]);

  const totalTunnelCount = sessionCards.reduce((sum, card) => sum + card.tunnels.length + card.suppressedPorts.length, 0);

  if (totalTunnelCount === 0) return null;

  function setBusyKey(key: string, on: boolean) {
    setBusy((prev) => {
      const s = new Set(prev);
      on ? s.add(key) : s.delete(key);
      return s;
    });
  }

  async function handlePause(sessionId: string, tunnelId: string) {
    const key = `${sessionId}-${tunnelId}`;
    setBusyKey(key, true);
    try { await closePfTunnel(sessionId, tunnelId); }
    catch (e) { console.error("pf_tunnel_close failed:", e); }
    finally { setBusyKey(key, false); }
  }

  async function handleResume(sessionId: string, port: number) {
    const key = `${sessionId}-${port}`;
    setBusyKey(key, true);
    try { await resumeAutoPort(sessionId, port); }
    catch (e) { console.error("pf_tunnel_resume_auto failed:", e); }
    finally { setBusyKey(key, false); }
  }

  async function handleDeleteActive(sessionId: string, tunnel: ActiveTunnel) {
    const key = `del-${sessionId}-${tunnel.id}`;
    setBusyKey(key, true);
    try {
      await closePfTunnel(sessionId, tunnel.id);
      setHiddenPorts((prev) => new Set([...prev, `${sessionId}:${tunnel.remote_port}`]));
    } catch (e) { console.error("pf_tunnel_close failed:", e); }
    finally { setBusyKey(key, false); }
  }

  function handleDeletePaused(sessionId: string, port: number) {
    setHiddenPorts((prev) => new Set([...prev, `${sessionId}:${port}`]));
  }

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between px-1 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-(--t-text-dim)">
          {t("portForwarding.activeTunnels.sectionTitle")}
        </span>
        <div className="flex items-center gap-2 text-[10px] text-(--t-text-muted)">
          <span className="px-1.5 py-0.5 rounded-full bg-(--t-bg-elevated) leading-none">{t("portForwarding.activeTunnels.hostCount", { count: sessionCards.length })}</span>
          <span className="px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 leading-none">{t("portForwarding.activeTunnels.tunnelCount", { count: totalTunnelCount })}</span>
        </div>
      </div>

      <div className={layoutMode === "grid"
        ? "grid grid-cols-[repeat(auto-fill,minmax(21rem,1fr))] gap-4"
        : "flex flex-col gap-3"
      }>
        {sessionCards.map(({ session, connection, tunnels, suppressedPorts, errorCount }) => {
          const displayIcon = connection ? (connection.icon || connection.distro) : null;
          const distroIcon = displayIcon ? getConnectionIcon(displayIcon) : null;
          const distroColor = displayIcon ? getConnectionIconColor(displayIcon) : "var(--t-bg-card-avatar)";
          const activeCount = tunnels.length - errorCount;
          const totalForwards = tunnels.length + suppressedPorts.length;

          return (
            <div
              key={session.id}
              className="group overflow-hidden rounded-[1.35rem] border border-(--t-border) bg-(--t-bg-card) transition-all duration-150 hover:border-(--t-border-hover) hover:bg-(--t-bg-card-hover)"
              data-card="true"
            >
              <div
                className="relative flex items-center gap-3 px-4 py-4"
                style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${distroColor} 24%, transparent), transparent 62%)` }}
              >
                <AvatarTile base={distroColor} icon={distroIcon ?? "lucide:server"} iconSize={30} className="h-14 w-14 rounded-2xl text-white" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="truncate text-base font-bold text-(--t-text-bright)">{session.connectionName}</p>
                    <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" title={t("portForwarding.activeTunnels.connected")} />
                  </div>
                  <p className="truncate text-xs text-(--t-text-dim)">
                    {connection ? `${connection.username}@${connection.host}:${connection.port}` : session.id}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="rounded-md bg-(--t-bg-input) text-(--t-text-dim) border border-(--t-border) px-2 py-1 text-[10px] font-semibold uppercase tracking-wider">
                    {t("portForwarding.activeTunnels.forwardCount", { count: totalForwards })}
                  </span>
                  {errorCount > 0 ? (
                    <span className="text-[10px] font-medium text-red-400">{t("portForwarding.activeTunnels.errorCount", { count: errorCount })}</span>
                  ) : (
                    <span className="text-[10px] font-medium text-green-400">{t("portForwarding.activeTunnels.activeCountLabel", { count: activeCount })}</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5 px-3 pb-3">
                {tunnels.map((tunnel) => {
                  const key = `${session.id}-${tunnel.id}`;
                  const deleteKey = `del-${session.id}-${tunnel.id}`;
                  const isBusy = busy.has(key);
                  const isDeleting = busy.has(deleteKey);
                  const isAuto = tunnel.origin.type === "auto";
                  const isError = typeof tunnel.state === "object" && "error" in tunnel.state;
                  const errorMsg = isError ? (tunnel.state as { error: string }).error : null;
                  const portLabel = formatActiveTunnelLabel(tunnel);
                  const webUrl = !isError ? getLocalTunnelHttpUrl(tunnel.tunnel_type ?? "local", tunnel.remote_port, tunnel.local_port) : null;

                  return (
                    <div
                      key={key}
                      className="flex items-center gap-2 rounded-xl border border-transparent bg-(--t-bg-elevated)/70 px-2.5 py-2 transition-colors hover:border-(--t-border-hover)"
                    >
                      <div className={`h-2 w-2 shrink-0 rounded-full ${isError ? "bg-red-500" : "bg-green-500"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="truncate text-sm font-semibold text-(--t-text-bright)">
                            {tunnel.tunnel_type === "dynamic"
                              ? t("portForwarding.activeTunnels.socksPortLabel", { port: tunnel.local_port })
                              : t("portForwarding.activeTunnels.portLabel", { port: tunnel.remote_port })}
                          </p>
                          <span className={`text-[10px] px-1 py-0.5 rounded-sm font-medium shrink-0 leading-none ${isAuto ? "bg-purple-500/20 text-purple-400" : "bg-(--t-bg-subtle) text-(--t-text-muted)"}`}>
                            {isAuto ? t("portForwarding.activeTunnels.auto") : t("portForwarding.activeTunnels.adHoc")}
                          </span>
                          <TunnelTypeBadge tunnelType={tunnel.tunnel_type} />
                        </div>
                        <p className={`truncate text-xs font-mono ${isError ? "text-red-400" : "text-(--t-text-secondary)"}`}>
                          {isError ? errorMsg : portLabel}
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); void handlePause(session.id, tunnel.id); }}
                        disabled={isBusy}
                        title={t("portForwarding.activeTunnels.pauseForwarding")}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-(--t-text-muted) transition-all hover:bg-amber-500/10 hover:text-amber-400 disabled:opacity-60"
                      >
                        {isBusy
                          ? <Icon icon="lucide:loader-circle" width={13} className="animate-spin" />
                          : <Icon icon="lucide:pause" width={13} />
                        }
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleDeleteActive(session.id, tunnel); }}
                        disabled={isDeleting}
                        title={t("common.action.delete")}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-(--t-text-muted) transition-all hover:bg-red-500/10 hover:text-red-400 disabled:opacity-60"
                      >
                        {isDeleting
                          ? <Icon icon="lucide:loader-circle" width={13} className="animate-spin" />
                          : <Icon icon="lucide:trash-2" width={13} />
                        }
                      </button>
                      {webUrl && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void openUrl(webUrl); }}
                          title={t("portForwarding.activeTunnels.openUrl", { url: webUrl })}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-(--t-text-muted) transition-all hover:bg-blue-500/10 hover:text-blue-400"
                        >
                          <Icon icon="lucide:globe" width={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {suppressedPorts.map((port) => {
                  const key = `${session.id}-${port}`;
                  const isBusy = busy.has(key);

                  return (
                    <div
                      key={`suppressed-${session.id}-${port}`}
                      className="flex items-center gap-2 rounded-xl border border-transparent bg-(--t-bg-elevated)/70 px-2.5 py-2 transition-colors hover:border-(--t-border-hover)"
                    >
                      <div className="h-2 w-2 shrink-0 rounded-full bg-(--t-text-dim) opacity-40" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="truncate text-sm font-semibold text-(--t-text-bright)">{t("portForwarding.activeTunnels.portLabel", { port })}</p>
                          <span className="text-[10px] px-1 py-0.5 rounded-sm font-medium shrink-0 leading-none bg-purple-500/20 text-purple-400">{t("portForwarding.activeTunnels.auto")}</span>
                        </div>
                        <p className="truncate text-xs font-mono text-(--t-text-secondary)">{port} → 127.0.0.1:{port}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleResume(session.id, port); }}
                        disabled={isBusy}
                        title={t("portForwarding.activeTunnels.resumeForwarding")}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-(--t-text-muted) transition-all hover:bg-green-500/10 hover:text-green-400 disabled:opacity-60"
                      >
                        {isBusy
                          ? <Icon icon="lucide:loader-circle" width={13} className="animate-spin" />
                          : <Icon icon="lucide:play" width={13} />
                        }
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeletePaused(session.id, port); }}
                        title={t("common.action.delete")}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-(--t-text-muted) transition-all hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Icon icon="lucide:trash-2" width={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
