import { writeClipboard } from "../../utils/clipboard";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { usePluginStore } from "@/stores/pluginStore";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useStatusBarContributions } from "@/hooks/useStatusBarContributions";
import { getPfState } from "@/services/portForwardingTunnels";
import { sshGetSystemInfo, type SystemInfo } from "@/services/ssh";
import { metricsStart, metricsStop, onMetricsSnapshot } from "@/services/metrics";
import { getDistroIcon, getDistroColor, getDistroLabel } from "@/utils/icons";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import type { ActiveTunnel, SerialConnectParams } from "@/types";
import type { MetricsSnapshot } from "@/plugins/monitoring/types";
import type { TerminalStatusBarContributionContext } from "@/plugins/api";

interface PfStatePayload {
  session_id: string;
  tunnels: ActiveTunnel[];
  suppressed_ports: number[];
}

interface Props {
  sessionId: string;
  sessionType: "ssh" | "local" | "serial";
  connectionId: string;
  connectionName?: string;
  serialConfig?: SerialConnectParams;
  sessionStatus: "connecting" | "connected" | "disconnected" | "error";
  dimensions?: { cols: number; rows: number };
}

interface ConnectedSystemInfo {
  os_name: string;
  os_version: string;
  kernel_version: string;
  host_name: string;
  arch: string;
}

function latencyColor(ms: number): string {
  if (ms < 50) return "var(--t-status-connected)";
  if (ms < 150) return "var(--t-status-warning)";
  return "var(--t-status-error)";
}

function sessionBadge(sessionType: Props["sessionType"]): string {
  if (sessionType === "ssh") return "SSH";
  if (sessionType === "serial") return "SERIAL";
  return "LOCAL";
}

function localSystemIcon(osName: string): string {
  const os = osName.toLowerCase();
  if (os.includes("darwin") || os.includes("mac")) return "lucide:apple";
  if (os.includes("windows")) return "lucide:monitor";
  return getDistroIcon(osName || "linux");
}

function localSystemColor(osName: string): string {
  const os = osName.toLowerCase();
  if (os.includes("darwin") || os.includes("mac")) return "var(--t-text-dim)";
  if (os.includes("windows")) return "#0078D4";
  return getDistroColor(osName || "linux");
}

function localSystemLabel(info: ConnectedSystemInfo | null): string {
  if (!info) return "Local system";
  const version = info.os_version ? ` ${info.os_version}` : "";
  return `${info.os_name || "Local system"}${version}`;
}

function cpuColor(pct: number): string {
  if (pct > 80) return "var(--t-status-error)";
  if (pct > 60) return "var(--t-status-warning)";
  return "var(--t-text-dim)";
}

function fmtMem(kb: number): string {
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(0)}M`;
  return `${(kb / 1024 / 1024).toFixed(1)}G`;
}

function fmtNet(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)}B`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)}K`;
  return `${(bps / 1024 / 1024).toFixed(1)}M`;
}

function fmtUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}d ${String(rh).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function sparklinePoints(values: number[], width: number, height: number): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

const SPARKLINE_MAX = 20;
const statusBarItemClass = "h-full rounded-none transition-colors hover:bg-(--t-bg-card-hover)";
const statusBarIdentityGroupClass = "flex items-center h-full";

export function TerminalStatusBar({ sessionId, sessionType, connectionId, connectionName, serialConfig, sessionStatus, dimensions }: Props) {
  const connections = useAllConnections();
  const connection = useMemo(() => connections.find((c) => c.id === connectionId), [connections, connectionId]);
  const pingStatus = useHostPingStore((s) => s.statuses[connectionId]);
  const latencyMs = useHostPingStore((s) => s.latencies[connectionId]);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const rightPanelSection = useUIStore((s) => s.rightPanelSection);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const monitoringActive = usePluginStore((s) => s.rightPanelSections.has("monitoring"));
  const reconnect = useSessionStore((s) => s.reconnect);
  const disconnect = useSessionStore((s) => s.disconnect);

  const [tunnels, setTunnels] = useState<ActiveTunnel[]>([]);
  const [pulse, setPulse] = useState(false);
  const prevCountRef = useRef(0);

  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connectedAtRef = useRef<number | null>(null);
  const [uptime, setUptime] = useState<string | null>(null);

  const [showDimensions, setShowDimensions] = useState(false);
  const dimensionsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // System info popover
  const [showDistroInfo, setShowDistroInfo] = useState(false);
  const [copiedDistro, setCopiedDistro] = useState(false);
  const copiedDistroTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [localSystemInfo, setLocalSystemInfo] = useState<ConnectedSystemInfo | null>(null);
  const systemInfoFetchedRef = useRef(false);

  // SSH details are fetched lazily because they require a remote command.
  const handleDistroMouseEnter = useCallback(() => {
    setShowDistroInfo(true);
    if (systemInfoFetchedRef.current || sessionStatus !== "connected") return;
    systemInfoFetchedRef.current = true;
    if (sessionType === "ssh") {
      sshGetSystemInfo(sessionId).then(setSystemInfo).catch(() => {});
    }
  }, [sessionId, sessionType, sessionStatus]);

  useEffect(() => {
    systemInfoFetchedRef.current = false;
    setSystemInfo(null);
    setLocalSystemInfo(null);
  }, [sessionId, sessionType]);

  useEffect(() => {
    if (sessionType !== "local" || sessionStatus !== "connected") return;
    let cancelled = false;
    invoke<ConnectedSystemInfo>("get_connected_system_info", {
      sessionId,
      sessionType,
      sessionName: connectionName ?? "Local",
    }).then((info) => {
      if (!cancelled) setLocalSystemInfo(info);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId, sessionType, sessionStatus, connectionName]);

  // Latency sparkline
  const latencyHistoryRef = useRef<number[]>([]);
  const [showSparkline, setShowSparkline] = useState(false);
  const [sparklineSnapshot, setSparklineSnapshot] = useState<number[]>([]);

  // CPU alert
  const [highCpu, setHighCpu] = useState(false);

  // Context menu
  const { pos: ctxPos, open: openCtx, close: closeCtx } = useContextMenu();

  // ── Latency history buffer ────────────────────────────────────────────────

  useEffect(() => {
    if (pingStatus === "up" && latencyMs !== undefined) {
      const buf = latencyHistoryRef.current;
      buf.push(latencyMs);
      if (buf.length > SPARKLINE_MAX) buf.shift();
    }
  }, [latencyMs, pingStatus]);

  // Snapshot the buffer when the popover opens so it stays stable during hover
  useEffect(() => {
    if (showSparkline) setSparklineSnapshot([...latencyHistoryRef.current]);
  }, [showSparkline]);

  // ── CPU alert hysteresis ──────────────────────────────────────────────────

  useEffect(() => {
    if (!metrics) { setHighCpu(false); return; }
    setHighCpu((prev) => {
      if (metrics.cpu_percent > 90) return true;
      if (metrics.cpu_percent < 85) return false;
      return prev;
    });
  }, [metrics]);

  // ── Dimensions flash ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!dimensions) return;
    setShowDimensions(true);
    if (dimensionsTimeoutRef.current) clearTimeout(dimensionsTimeoutRef.current);
    dimensionsTimeoutRef.current = setTimeout(() => setShowDimensions(false), 2000);
  }, [dimensions?.cols, dimensions?.rows]);

  // ── Session uptime ────────────────────────────────────────────────────────

  useEffect(() => {
    if (sessionStatus === "connected") {
      if (connectedAtRef.current === null) connectedAtRef.current = Date.now();
      const tick = () => {
        const elapsed = Math.floor((Date.now() - connectedAtRef.current!) / 1000);
        setUptime(fmtUptime(elapsed));
      };
      tick();
      const interval = setInterval(tick, 1000);
      return () => clearInterval(interval);
    } else {
      connectedAtRef.current = null;
      setUptime(null);
    }
  }, [sessionStatus]);

  // ── Port forwarding events ────────────────────────────────────────────────

  useEffect(() => {
    if (sessionType !== "ssh") return;

    getPfState(sessionId).then((s) => setTunnels(s.tunnels)).catch(() => {});

    let cleanup: (() => void) | undefined;
    listen<PfStatePayload>("pf-state-changed", ({ payload }) => {
      if (payload.session_id === sessionId) setTunnels(payload.tunnels);
    }).then((u) => { cleanup = u; });

    return () => { cleanup?.(); };
  }, [sessionId, sessionType]);

  useEffect(() => {
    const count = tunnels.length;
    if (count !== prevCountRef.current && prevCountRef.current !== 0) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 500);
      prevCountRef.current = count;
      return () => clearTimeout(t);
    }
    prevCountRef.current = count;
  }, [tunnels.length]);

  // ── Metrics stream ────────────────────────────────────────────────────────

  const stopStream = useCallback(async () => {
    unlistenRef.current?.();
    unlistenRef.current = null;
    if (streamIdRef.current) {
      await metricsStop(streamIdRef.current).catch(() => {});
      streamIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!monitoringActive || sessionType !== "ssh" || sessionStatus !== "connected") {
      stopStream();
      setMetrics(null);
      return;
    }

    let cancelled = false;
    (async () => {
      await stopStream();
      if (cancelled) return;
      try {
        const sid = await metricsStart(sessionId, true);
        if (cancelled) { metricsStop(sid).catch(() => {}); return; }
        streamIdRef.current = sid;
        const unlisten = await onMetricsSnapshot(sid, (s) => setMetrics(s));
        if (cancelled) { unlisten(); metricsStop(sid).catch(() => {}); return; }
        unlistenRef.current = unlisten;
      } catch { /* monitoring unavailable */ }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sessionType, sessionStatus, monitoringActive]);

  // ── Fast ping for active session ──────────────────────────────────────────

  const [pingEnabled] = useToggle("reachability");
  const activePollIntervalMs = useHostPingStore((s) => s.activePollIntervalMs);
  const setStatus = useHostPingStore((s) => s.setStatus);

  useEffect(() => {
    if (!pingEnabled || sessionType !== "ssh" || sessionStatus !== "connected" || !connection) return;
    if (connection.jump_hosts?.length) return;

    let cancelled = false;
    const ping = async () => {
      try {
        const ms = await invoke<number | null>("ping_host", { host: connection.host, port: connection.port });
        if (!cancelled) {
          if (ms !== null && ms !== undefined) setStatus(connectionId, "up", ms);
          else setStatus(connectionId, "down");
        }
      } catch {
        if (!cancelled) setStatus(connectionId, "unknown");
      }
    };

    ping();
    const interval = setInterval(ping, activePollIntervalMs);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pingEnabled, sessionType, sessionStatus, connectionId, connection, activePollIntervalMs, setStatus]);

  // ── Context menu items ────────────────────────────────────────────────────

  const copyHostText = sessionType === "ssh" && connection
    ? `${connection.username}@${connection.host}`
    : (serialConfig?.port ?? "");

  const ctxItems = useMemo<ContextMenuItem[]>(() => {
    if (sessionType === "ssh" && connection) {
      return [
        {
          label: `Copy ${connection.username}@${connection.host}`,
          icon: "lucide:copy",
          onClick: () => writeClipboard(`${connection.username}@${connection.host}`).catch(() => {}),
        },
        {
          label: `Copy ${connection.host}`,
          icon: "lucide:server",
          onClick: () => writeClipboard(connection.host).catch(() => {}),
        },
        {
          label: "Open ports panel",
          icon: "lucide:network",
          onClick: () => toggleRightPanel("ports"),
        },
        {
          label: "Disconnect",
          icon: "lucide:plug",
          danger: true,
          divider: true,
          onClick: () => void disconnect(sessionId),
        },
      ];
    }
    if (sessionType === "serial" && serialConfig) {
      return [
        {
          label: `Copy ${serialConfig.port}`,
          icon: "lucide:copy",
          onClick: () => writeClipboard(serialConfig.port).catch(() => {}),
        },
        {
          label: "Disconnect",
          icon: "lucide:plug",
          danger: true,
          divider: true,
          onClick: () => void disconnect(sessionId),
        },
      ];
    }
    if (sessionType === "local") {
      return [
        {
          label: "Disconnect",
          icon: "lucide:plug",
          danger: true,
          divider: true,
          onClick: () => void disconnect(sessionId),
        },
      ];
    }
    return [];
  }, [sessionType, connection, serialConfig, connectionName, sessionId, toggleRightPanel, disconnect]);

  const statusBarContributionContext = useMemo<TerminalStatusBarContributionContext>(() => ({
    sessionId,
    sessionType,
    connectionId,
    sessionStatus,
    connection,
    connectionName,
    serialConfig,
    dimensions,
  }), [sessionId, sessionType, connectionId, sessionStatus, connection, connectionName, serialConfig, dimensions]);

  const statusBarContributions = useStatusBarContributions(
    "terminal.statusBar.right",
    statusBarContributionContext,
  );

  const activeTunnelCount = tunnels.filter((t) => t.state === "active").length;
  const portsIsActive = rightPanelOpen && rightPanelSection === "ports";
  const metricsIsActive = rightPanelOpen && rightPanelSection === "plugin:monitoring";
  const isConnected = sessionStatus === "connected";
  const isDisconnectedOrError = sessionStatus === "disconnected" || sessionStatus === "error";

  const dotColor = pingStatus === "up"
    ? latencyColor(latencyMs ?? 999)
    : pingStatus === "down"
    ? "var(--t-status-error)"
    : "var(--t-text-dim)";

  const dotTitle = pingStatus === "up" && latencyMs !== undefined
    ? `Up · ${latencyMs}ms`
    : pingStatus === "down"
    ? "Down"
    : "Unknown";

  const distroIcon = connection?.distro ? getDistroIcon(connection.distro) : null;
  const localOsName = localSystemInfo?.os_name ?? "linux";
  const systemIcon = sessionType === "ssh" ? distroIcon : sessionType === "local" ? localSystemIcon(localOsName) : null;
  const showDistroPopover = (sessionType === "ssh" && !!connection?.distro) || sessionType === "local";
  const systemInfoCopyText = sessionType === "ssh" && connection?.distro
    ? systemInfo
      ? `${systemInfo.pretty_name || getDistroLabel(connection.distro)}${systemInfo.kernel ? ` · ${systemInfo.kernel} ${systemInfo.arch}` : ""}`
      : getDistroLabel(connection.distro)
    : sessionType === "local"
    ? localSystemInfo
      ? `${localSystemLabel(localSystemInfo)}${localSystemInfo.kernel_version ? ` · ${localSystemInfo.kernel_version} ${localSystemInfo.arch}` : ""}`
      : "Local system"
    : "";

  const handleCopyHost = () => {
    if (!copyHostText) return;
    writeClipboard(copyHostText).then(() => {
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  };

  const borderTopColor = sessionStatus === "error"
    ? "color-mix(in srgb, var(--t-status-error) 60%, transparent)"
    : sessionStatus === "disconnected"
    ? "color-mix(in srgb, var(--t-status-error) 40%, transparent)"
    : "var(--t-border)";

  // Jump host breadcrumb
  const jumpHosts = connection?.jump_hosts;
  const jumpLabel = jumpHosts?.length
    ? jumpHosts[0].host + (jumpHosts.length > 1 ? ` +${jumpHosts.length - 1}` : "")
    : null;

  // Sparkline stats
  const spMin = sparklineSnapshot.length ? Math.min(...sparklineSnapshot) : 0;
  const spMax = sparklineSnapshot.length ? Math.max(...sparklineSnapshot) : 0;
  const spAvg = sparklineSnapshot.length
    ? Math.round(sparklineSnapshot.reduce((a, b) => a + b, 0) / sparklineSnapshot.length)
    : 0;
  const spPoints = sparklinePoints(sparklineSnapshot, 80, 20);

  return (
    <>
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{
          height: 24,
          background: "var(--t-bg-status-bar)",
          borderTop: `1px solid ${borderTopColor}`,
          fontSize: 11,
        }}
        onContextMenu={ctxItems.length ? openCtx : undefined}
      >
        {/* Left: connection info */}
        <div className={`flex items-center gap-2 h-full${sessionStatus === "connecting" ? " statusbar-connecting-pulse" : ""}`}>
          <span className="px-1.5 text-[10px] font-semibold text-(--t-text-dim)">
            {sessionBadge(sessionType)}
          </span>
          {sessionType === "ssh" && connection && (
            <>
              {/* Dot + latency: hover area for sparkline */}
              <div
                style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}
                onMouseEnter={() => setShowSparkline(true)}
                onMouseLeave={() => setShowSparkline(false)}
              >
                <div
                  title={dotTitle}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: dotColor,
                    flexShrink: 0,
                    transition: "background 0.4s",
                  }}
                />
                {pingStatus === "up" && latencyMs !== undefined && (
                  <span style={{ color: latencyColor(latencyMs), fontVariantNumeric: "tabular-nums" }}>
                    {latencyMs}ms
                  </span>
                )}
                {/* Sparkline popover */}
                {showSparkline && sparklineSnapshot.length >= 2 && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: "calc(100% + 6px)",
                      left: 0,
                      background: "var(--t-bg-card)",
                      border: "1px solid var(--t-border)",
                      borderRadius: 8,
                      padding: "8px 10px",
                      zIndex: 50,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                      pointerEvents: "none",
                    }}
                  >
                    <svg width={80} height={20} style={{ display: "block" }}>
                      <polyline
                        points={spPoints}
                        fill="none"
                        stroke={latencyColor(spAvg)}
                        strokeWidth={1.5}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    </svg>
                    <div
                      style={{
                        marginTop: 4,
                        display: "flex",
                        gap: 8,
                        color: "var(--t-text-dim)",
                        fontSize: 10,
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span>min {spMin}ms</span>
                      <span>avg {spAvg}ms</span>
                      <span>max {spMax}ms</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Jump host breadcrumb */}
              {jumpLabel && (
                <>
                  <span
                    style={{
                      color: "var(--t-text-dim)",
                      maxWidth: 80,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {jumpLabel}
                  </span>
                  <Icon icon="lucide:arrow-right" width={9} className="text-(--t-text-dim)" style={{ flexShrink: 0 }} />
                </>
              )}

              <div className={statusBarIdentityGroupClass}>
                {systemIcon && showDistroPopover && (
                  <div
                    className={`flex items-center px-1 ${statusBarItemClass}`}
                    style={{ position: "relative", display: "flex", alignItems: "center" }}
                    onMouseEnter={showDistroPopover ? handleDistroMouseEnter : undefined}
                    onMouseLeave={showDistroPopover ? () => setShowDistroInfo(false) : undefined}
                  >
                    <Icon
                      icon={systemIcon}
                      width={12}
                      style={{ flexShrink: 0, color: "var(--t-text-dim)", cursor: "pointer" }}
                      onClick={showDistroPopover ? () => {
                        if (!systemInfoCopyText) return;
                        writeClipboard(systemInfoCopyText).catch(() => {});
                        setCopiedDistro(true);
                        if (copiedDistroTimeoutRef.current) clearTimeout(copiedDistroTimeoutRef.current);
                        copiedDistroTimeoutRef.current = setTimeout(() => setCopiedDistro(false), 1200);
                      } : undefined}
                    />
                    {showDistroInfo && showDistroPopover && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "calc(100% + 6px)",
                          left: 0,
                          background: "var(--t-bg-card)",
                          border: "1px solid var(--t-border)",
                          borderRadius: 8,
                          padding: "8px 12px",
                          zIndex: 50,
                          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                          pointerEvents: "none",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <Icon
                          icon={systemIcon}
                          width={22}
                          style={{
                            color: getDistroColor(connection?.distro ?? "linux"),
                            flexShrink: 0,
                          }}
                        />
                        {copiedDistro ? (
                          <span style={{ color: "var(--t-text-primary)", fontSize: 11 }}>Copied!</span>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ color: "var(--t-text-primary)", fontSize: 11 }}>
                              {systemInfo?.pretty_name || getDistroLabel(connection!.distro!)}
                            </span>
                            {systemInfo?.kernel && (
                              <span style={{ color: "var(--t-text-dim)", fontSize: 10 }}>
                                {systemInfo.kernel} · {systemInfo.arch}
                              </span>
                            )}
                            {!systemInfo && (
                              <span style={{ color: "var(--t-text-dim)", fontSize: 10 }}>loading…</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <span
                  title={`${connection.username}@${connection.host}`}
                  onClick={handleCopyHost}
                  className={`flex items-center px-1 text-(--t-text-dim) ${statusBarItemClass}`}
                  style={{
                    maxWidth: 160,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                  }}
                >
                  {copied ? "Copied!" : `${connection.username}@${connection.host}`}
                </span>
              </div>
              {isDisconnectedOrError && (
                <button
                  onClick={() => void reconnect(sessionId)}
                  title="Reconnect"
                  className={`items-center px-1 ${statusBarItemClass}`}
                  style={{ color: "var(--t-status-error)", display: "flex", alignItems: "center" }}
                >
                  <Icon icon="lucide:rotate-ccw" width={11} />
                </button>
              )}
            </>
          )}
          {sessionType === "local" && systemIcon && showDistroPopover && (
            <div
              className={`flex items-center px-1 ${statusBarItemClass}`}
              style={{ position: "relative", display: "flex", alignItems: "center" }}
              onMouseEnter={handleDistroMouseEnter}
              onMouseLeave={() => setShowDistroInfo(false)}
            >
              <Icon
                icon={systemIcon}
                width={12}
                style={{ flexShrink: 0, color: localSystemColor(localOsName), cursor: "pointer" }}
                onClick={() => {
                  if (!systemInfoCopyText) return;
                  writeClipboard(systemInfoCopyText).catch(() => {});
                  setCopiedDistro(true);
                  if (copiedDistroTimeoutRef.current) clearTimeout(copiedDistroTimeoutRef.current);
                  copiedDistroTimeoutRef.current = setTimeout(() => setCopiedDistro(false), 1200);
                }}
              />
              {showDistroInfo && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    left: 0,
                    background: "var(--t-bg-card)",
                    border: "1px solid var(--t-border)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    zIndex: 50,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                    pointerEvents: "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    whiteSpace: "nowrap",
                  }}
                >
                  <Icon icon={systemIcon} width={22} style={{ color: localSystemColor(localOsName), flexShrink: 0 }} />
                  {copiedDistro ? (
                    <span style={{ color: "var(--t-text-primary)", fontSize: 11 }}>Copied!</span>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ color: "var(--t-text-primary)", fontSize: 11 }}>
                        {localSystemLabel(localSystemInfo)}
                      </span>
                      {localSystemInfo?.kernel_version && (
                        <span style={{ color: "var(--t-text-dim)", fontSize: 10 }}>
                          {localSystemInfo.kernel_version} · {localSystemInfo.arch}
                        </span>
                      )}
                      {localSystemInfo?.host_name && (
                        <span style={{ color: "var(--t-text-dim)", fontSize: 10 }}>
                          {localSystemInfo.host_name}
                        </span>
                      )}
                      {!localSystemInfo && (
                        <span style={{ color: "var(--t-text-dim)", fontSize: 10 }}>loading…</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {sessionType === "serial" && (
            <>
              <Icon icon="lucide:ethernet-port" width={11} className="text-(--t-text-dim)" />
              <span
                title={serialConfig ? `${serialConfig.port} · ${serialConfig.baud} baud` : "serial"}
                onClick={handleCopyHost}
                className={`flex items-center px-1 text-(--t-text-dim) ${statusBarItemClass}`}
                style={{
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {copied ? "Copied!" : (serialConfig ? `${serialConfig.port} · ${serialConfig.baud} baud` : "serial")}
              </span>
              {isDisconnectedOrError && (
                <button
                  onClick={() => void reconnect(sessionId)}
                  title="Reconnect"
                  className={`items-center px-1 ${statusBarItemClass}`}
                  style={{ color: "var(--t-status-error)", display: "flex", alignItems: "center" }}
                >
                  <Icon icon="lucide:rotate-ccw" width={11} />
                </button>
              )}
            </>
          )}
        </div>

        {/* Right: uptime + dimensions + plugin widgets + metrics + ports chips */}
        <div
          className="flex items-center h-full"
          style={!isConnected ? { opacity: 0.35, pointerEvents: "none" } : undefined}
        >
          {statusBarContributions.map(({ key, node }) => (
            <Fragment key={key}>{node}</Fragment>
          ))}
          {uptime && (
            <span className="px-1.5 text-(--t-text-dim)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {uptime}
            </span>
          )}
          {showDimensions && dimensions && (
            <span className="px-1.5 text-(--t-text-dim)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {dimensions.cols}×{dimensions.rows}
            </span>
          )}
          {metrics && (
            <button
              onClick={() => toggleRightPanel("plugin:monitoring")}
              className={`flex items-center gap-1.5 px-1.5 ${statusBarItemClass}`}
              style={{
                color: "var(--t-text-dim)",
                background: metricsIsActive ? "var(--t-bg-elevated)" : undefined,
              }}
              title="System metrics"
            >
              <span
                className={highCpu ? "cpu-alert-pulse" : undefined}
                style={{ color: cpuColor(metrics.cpu_percent), fontVariantNumeric: "tabular-nums" }}
              >
                CPU {metrics.cpu_percent.toFixed(0)}%
              </span>
              <span className="text-(--t-text-dim)">·</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtMem(metrics.mem_used_kb)}/{fmtMem(metrics.mem_total_kb)}
              </span>
              {(metrics.net_rx_bytes_per_sec > 0 || metrics.net_tx_bytes_per_sec > 0) && (
                <>
                  <span className="text-(--t-text-dim)">·</span>
                  <span className="flex items-center gap-0.5" style={{ fontVariantNumeric: "tabular-nums" }}>
                    <Icon icon="lucide:arrow-down" width={9} />
                    {fmtNet(metrics.net_rx_bytes_per_sec)}
                  </span>
                  <span className="flex items-center gap-0.5" style={{ fontVariantNumeric: "tabular-nums" }}>
                    <Icon icon="lucide:arrow-up" width={9} />
                    {fmtNet(metrics.net_tx_bytes_per_sec)}
                  </span>
                </>
              )}
            </button>
          )}
          {sessionType === "ssh" && (
            <button
              onClick={() => toggleRightPanel("ports")}
              className={`flex items-center gap-1 px-1.5 ${statusBarItemClass}`}
              style={{
                color: "var(--t-text-dim)",
                background: portsIsActive
                  ? "var(--t-bg-elevated)"
                  : pulse
                  ? "var(--t-bg-card)"
                  : undefined,
              }}
              title={`${activeTunnelCount} active tunnel${activeTunnelCount !== 1 ? "s" : ""}`}
            >
              <Icon icon="lucide:network" width={11} />
              {activeTunnelCount > 0 && <span>{activeTunnelCount}</span>}
            </button>
          )}
        </div>
      </div>

      {ctxPos && <ContextMenu items={ctxItems} pos={ctxPos} onClose={closeCtx} direction="up" />}
    </>
  );
}
