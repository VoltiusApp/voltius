import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { useDragStore } from "@/stores/dragStore";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { findLeaf, getPaneSessionIds, useLayoutStore, type SplitPosition } from "@/stores/layoutStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { getConnectionIcon, getConnectionIconColor, getDistroColor, getDistroIcon, getDistroLabel } from "@/utils/icons";
import { sshGetSystemInfo, type SystemInfo } from "@/services/ssh";
import type { TerminalSession } from "@/types";

function latencyColor(ms: number): string {
  if (ms < 50) return "var(--t-status-connected)";
  if (ms < 150) return "var(--t-status-warning)";
  return "var(--t-status-error)";
}

function statusColor(status: TerminalSession["status"]): string {
  if (status === "connected") return "var(--t-status-connected)";
  if (status === "connecting") return "var(--t-status-connecting)";
  if (status === "error") return "var(--t-status-error)";
  return "var(--t-text-muted)";
}

function sessionBadge(session: TerminalSession): string {
  if (session.type === "ssh") return "SSH";
  if (session.type === "serial") return "SERIAL";
  if (session.type === "multiplayer") return "MPX";
  return "LOCAL";
}

interface ConnectedSystemInfo {
  os_name: string;
  os_version: string;
  kernel_version: string;
  host_name: string;
  arch: string;
}

function localSystemIcon(osName: string): string {
  const os = osName.toLowerCase();
  if (os.includes("darwin") || os.includes("mac")) return "lucide:apple";
  if (os.includes("windows")) return "lucide:monitor";
  return getDistroIcon(osName || "linux");
}

function localSystemColor(osName: string): string {
  const os = osName.toLowerCase();
  if (os.includes("darwin") || os.includes("mac")) return "var(--t-text-secondary)";
  if (os.includes("windows")) return "#0078D4";
  return getDistroColor(osName || "linux");
}

function localSystemLabel(info: ConnectedSystemInfo | null): string {
  if (!info) return "Local system";
  const version = info.os_version ? ` ${info.os_version}` : "";
  return `${info.os_name || "Local system"}${version}`;
}

const SPARKLINE_MAX = 20;

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

const tooltipStyle: React.CSSProperties = {
  position: "fixed",
  background: "var(--t-bg-card)",
  border: "1px solid var(--t-border)",
  borderRadius: 8,
  padding: "8px 10px",
  zIndex: 100,
  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
  pointerEvents: "none",
};

export function PaneHeader({ paneId, session, active }: { paneId: string; session: TerminalSession; active: boolean }) {
  const connections = useAllConnections();
  const connection = connections.find((c) => c.id === session.connectionId);
  const latencyMs = useHostPingStore((s) => s.latencies[session.connectionId]);
  const pingStatus = useHostPingStore((s) => s.statuses[session.connectionId]);
  const [pingEnabled] = useToggle("reachability");
  const activePollIntervalMs = useHostPingStore((s) => s.activePollIntervalMs);
  const setStatus = useHostPingStore((s) => s.setStatus);
  const closePane = useLayoutStore((s) => s.closePane);
  const splitPane = useLayoutStore((s) => s.splitPane);
  const detachPane = useLayoutStore((s) => s.detachPane);
  const maximizedPaneId = useLayoutStore((s) => s.maximizedPaneId);
  const setMaximized = useLayoutStore((s) => s.setMaximized);
  const broadcastActive = useLayoutStore((s) => s.broadcastActive);
  const toggleBroadcast = useLayoutStore((s) => s.toggleBroadcast);
  const reconnect = useSessionStore((s) => s.reconnect);
  const sessions = useSessionStore((s) => s.sessions);
  const mpState = useTeamSessionStore((s) => s.connections[session.id]);
  const { pos, open, close } = useContextMenu();

  // Copy user@host
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Distro popover
  const [showDistroInfo, setShowDistroInfo] = useState(false);
  const [copiedDistro, setCopiedDistro] = useState(false);
  const copiedDistroTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [localSystemInfo, setLocalSystemInfo] = useState<ConnectedSystemInfo | null>(null);
  const systemInfoFetchedRef = useRef(false);
  const distroTriggerRef = useRef<HTMLSpanElement>(null);
  const [distroRect, setDistroRect] = useState<DOMRect | null>(null);

  // Latency sparkline
  const latencyHistoryRef = useRef<number[]>([]);
  const [showSparkline, setShowSparkline] = useState(false);
  const [sparklineSnapshot, setSparklineSnapshot] = useState<number[]>([]);
  const latencyTriggerRef = useRef<HTMLDivElement>(null);
  const [latencyRect, setLatencyRect] = useState<DOMRect | null>(null);

  const isMaximized = maximizedPaneId === paneId;
  const excludedFromBroadcast = broadcastActive && (session.type === "multiplayer" || (!!mpState && mpState.controlHolder !== "" && mpState.controlHolder !== mpState.myUserId));
  const connectionIcon = session.type === "ssh" && connection ? (connection.icon || connection.distro) : null;
  const displayConnectionIcon = connectionIcon ? getConnectionIcon(connectionIcon) : null;
  const localOsName = localSystemInfo?.os_name ?? "linux";
  const showDistroPopover = !!connection?.distro || session.type === "local";
  const icon = displayConnectionIcon ?? (session.type === "local" ? localSystemIcon(localOsName) : session.type === "serial" ? "lucide:ethernet-port" : "lucide:radio-tower");
  const iconBg = connectionIcon ? getConnectionIconColor(connectionIcon) : session.type === "local" ? localSystemColor(localOsName) : undefined;
  const subtitle = session.type === "serial" && session.serialConfig
    ? `${session.serialConfig.port} · ${session.serialConfig.baud}`
    : session.type === "ssh" && connection
      ? `${connection.username}@${connection.host}`
      : null;

  // ── Latency history buffer ────────────────────────────────────────────────

  useEffect(() => {
    if (pingStatus === "up" && latencyMs !== undefined) {
      const buf = latencyHistoryRef.current;
      buf.push(latencyMs);
      if (buf.length > SPARKLINE_MAX) buf.shift();
    }
  }, [latencyMs, pingStatus]);

  useEffect(() => {
    if (showSparkline) setSparklineSnapshot([...latencyHistoryRef.current]);
  }, [showSparkline]);

  useEffect(() => {
    if (session.type !== "local" || session.status !== "connected") {
      setLocalSystemInfo(null);
      return;
    }
    let cancelled = false;
    invoke<ConnectedSystemInfo>("get_connected_system_info", {
      sessionId: session.id,
      sessionType: session.type,
      sessionName: session.connectionName,
    }).then((info) => {
      if (!cancelled) setLocalSystemInfo(info);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [session.id, session.type, session.status, session.connectionName]);

  // ── Fast ping for active pane ─────────────────────────────────────────────

  useEffect(() => {
    if (!active || !pingEnabled || session.type !== "ssh" || session.status !== "connected" || !connection) return;
    if (connection.jump_hosts?.length) return;

    let cancelled = false;
    const ping = async () => {
      try {
        const ms = await invoke<number | null>("ping_host", { host: connection.host, port: connection.port });
        if (!cancelled) {
          if (ms !== null && ms !== undefined) setStatus(session.connectionId, "up", ms);
          else setStatus(session.connectionId, "down");
        }
      } catch {
        if (!cancelled) setStatus(session.connectionId, "unknown");
      }
    };

    ping();
    const interval = setInterval(ping, activePollIntervalMs);
    return () => { cancelled = true; clearInterval(interval); };
  }, [active, pingEnabled, session.type, session.status, session.connectionId, connection, activePollIntervalMs, setStatus]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleDistroMouseEnter = useCallback(() => {
    if (distroTriggerRef.current) setDistroRect(distroTriggerRef.current.getBoundingClientRect());
    setShowDistroInfo(true);
    if (!systemInfoFetchedRef.current && session.type === "ssh" && session.status === "connected") {
      systemInfoFetchedRef.current = true;
      sshGetSystemInfo(session.id).then(setSystemInfo).catch(() => {});
    }
  }, [session.id, session.type, session.status]);

  const handleDistroClick = () => {
    const text = session.type === "local"
      ? localSystemInfo
        ? `${localSystemLabel(localSystemInfo)}${localSystemInfo.kernel_version ? ` · ${localSystemInfo.kernel_version} ${localSystemInfo.arch}` : ""}`
        : "Local system"
      : connection?.distro
      ? systemInfo
        ? `${systemInfo.pretty_name || getDistroLabel(connection.distro)}${systemInfo.kernel ? ` · ${systemInfo.kernel} ${systemInfo.arch}` : ""}`
        : getDistroLabel(connection.distro)
      : "";
    if (!text) return;
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedDistro(true);
    if (copiedDistroTimeoutRef.current) clearTimeout(copiedDistroTimeoutRef.current);
    copiedDistroTimeoutRef.current = setTimeout(() => setCopiedDistro(false), 1200);
  };

  const handleLatencyMouseEnter = () => {
    if (latencyTriggerRef.current) setLatencyRect(latencyTriggerRef.current.getBoundingClientRect());
    setShowSparkline(true);
  };

  const handleLatencyClick = () => {
    if (latencyMs === undefined) return;
    navigator.clipboard.writeText(`${latencyMs}ms`).catch(() => {});
  };

  const handleCopySubtitle = () => {
    if (!subtitle) return;
    navigator.clipboard.writeText(subtitle).then(() => {
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  };

  const handleClosePane = () => {
    closePane(paneId);
    const layout = useLayoutStore.getState();
    const nextLeaf = findLeaf(layout.root, layout.activePaneId);
    if (nextLeaf) useSessionStore.getState().setActive(nextLeaf.sessionId);
  };

  const handleDetachPane = () => {
    const detachedSessionId = detachPane(paneId);
    if (detachedSessionId) useSessionStore.getState().setActive(detachedSessionId);
  };

  const handleContextSplit = (position: SplitPosition) => {
    const visibleSessionIds = new Set(getPaneSessionIds(useLayoutStore.getState().root));
    const candidate = sessions.find((s) => !visibleSessionIds.has(s.id));
    if (!candidate) {
      useNotificationStore.getState().addToast({
        pluginId: "core",
        pluginName: "Voltius",
        type: "toast",
        message: "Open another session or drag an existing tab onto a pane to split.",
        severity: "info",
        duration: 3000,
      });
      return;
    }
    splitPane(paneId, candidate.id, position);
    useSessionStore.getState().setActive(candidate.id);
  };

  const menuItems: ContextMenuItem[] = [
    { label: "Reconnect", icon: "lucide:rotate-cw", onClick: () => void reconnect(session.id) },
    {
      label: "Split",
      icon: "lucide:columns-3",
      children: [
        { label: "Split left", icon: "lucide:arrow-left-to-line", onClick: () => handleContextSplit("left") },
        { label: "Split right", icon: "lucide:arrow-right-to-line", onClick: () => handleContextSplit("right") },
        { label: "Split top", icon: "lucide:arrow-up-to-line", onClick: () => handleContextSplit("top") },
        { label: "Split bottom", icon: "lucide:arrow-down-to-line", onClick: () => handleContextSplit("bottom") },
      ],
    },
    { label: "Detach pane", icon: "lucide:square-arrow-out-up-right", onClick: handleDetachPane },
    { label: "Close pane", icon: "lucide:x", danger: true, onClick: handleClosePane },
  ];

  const beginDrag = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      handleClosePane();
      return;
    }
    if (e.button !== 0) return;
    useDragStore.getState().beginPaneDrag(paneId, session.id, e.clientX, e.clientY);
  };

  // ── Sparkline stats ───────────────────────────────────────────────────────

  const spMin = sparklineSnapshot.length ? Math.min(...sparklineSnapshot) : 0;
  const spMax = sparklineSnapshot.length ? Math.max(...sparklineSnapshot) : 0;
  const spAvg = sparklineSnapshot.length
    ? Math.round(sparklineSnapshot.reduce((a, b) => a + b, 0) / sparklineSnapshot.length)
    : 0;
  const spPoints = sparklinePoints(sparklineSnapshot, 80, 20);

  return (
    <div
      onContextMenu={open}
      className="h-7 shrink-0 flex items-stretch gap-2 px-2 text-xs border-b"
      style={{
        background: broadcastActive
          ? "color-mix(in srgb, var(--t-accent) 12%, var(--t-bg-card))"
          : active
            ? "var(--t-bg-card)"
            : "color-mix(in srgb, var(--t-bg-card) 70%, var(--t-bg-terminal))",
        borderColor: "var(--t-border)",
        color: active ? "var(--t-text-primary)" : "var(--t-text-secondary)",
      }}
    >
      <div onMouseDown={beginDrag} className="min-w-0 flex-1 flex items-center gap-2 cursor-grab active:cursor-grabbing self-stretch">
        <span
          ref={distroTriggerRef}
          className={`size-5 rounded-md flex items-center justify-center shrink-0 transition-opacity${showDistroPopover ? " hover:opacity-75 cursor-pointer" : ""}`}
          style={{
            background: iconBg ?? "var(--t-bg-elevated)",
            color: iconBg ? "#fff" : "var(--t-text-secondary)",
          }}
          onMouseEnter={showDistroPopover ? handleDistroMouseEnter : undefined}
          onMouseLeave={showDistroPopover ? () => setShowDistroInfo(false) : undefined}
          onMouseDown={showDistroPopover ? (e) => e.stopPropagation() : undefined}
          onClick={showDistroPopover ? handleDistroClick : undefined}
        >
          <Icon icon={icon} width={13} />
        </span>
        <span className="truncate font-semibold">{session.connectionName}</span>
        {subtitle && (
          <span
            className="hidden md:flex items-center truncate max-w-[11rem] text-[var(--t-text-dim)] px-1 -mx-1 hover:bg-[var(--t-bg-card-hover)] transition-colors cursor-pointer self-stretch"
            title={subtitle}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleCopySubtitle}
          >
            {copied ? "Copied!" : subtitle}
          </span>
        )}
      </div>

      <div className="hidden sm:flex items-center gap-1.5 shrink-0 self-stretch">
        <span className="px-1.5 py-0.5 rounded border border-[var(--t-border)] bg-[var(--t-bg-elevated)] text-[10px] font-semibold">
          {sessionBadge(session)}
        </span>
        <span className="size-1.5 rounded-full" style={{ background: statusColor(session.status) }} />
        {session.type === "ssh" && pingStatus === "up" && latencyMs !== undefined && (
          <div
            ref={latencyTriggerRef}
            className="flex items-center self-stretch px-1 hover:bg-[var(--t-bg-card-hover)] transition-colors cursor-pointer"
            onMouseEnter={handleLatencyMouseEnter}
            onMouseLeave={() => setShowSparkline(false)}
            onClick={handleLatencyClick}
            title={`${latencyMs}ms — click to copy`}
          >
            <span style={{ color: latencyColor(latencyMs) }}>{latencyMs}ms</span>
          </div>
        )}
        {excludedFromBroadcast && <span title="Excluded from broadcast"><Icon icon="lucide:lock" width={13} /></span>}
      </div>

      <div className="flex items-stretch shrink-0">
        <button
          className="h-full px-1.5 flex items-center justify-center hover:bg-[var(--t-bg-card-hover)] transition-colors"
          title={broadcastActive ? "Disable broadcast" : "Broadcast input"}
          onClick={() => toggleBroadcast()}
          style={{ color: broadcastActive ? "var(--t-accent)" : "var(--t-text-dim)" }}
        >
          <Icon icon="lucide:radio-tower" width={13} />
        </button>
        <button
          className="h-full px-1.5 flex items-center justify-center hover:bg-[var(--t-bg-card-hover)] transition-colors text-[var(--t-text-dim)]"
          title="Detach pane"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleDetachPane}
        >
          <Icon icon="lucide:square-arrow-out-up-right" width={13} />
        </button>
        <button
          className="h-full px-1.5 flex items-center justify-center hover:bg-[var(--t-bg-card-hover)] transition-colors text-[var(--t-text-dim)]"
          title={isMaximized ? "Restore pane" : "Maximize pane"}
          onClick={() => setMaximized(isMaximized ? null : paneId)}
        >
          <Icon icon={isMaximized ? "lucide:minimize-2" : "lucide:maximize-2"} width={13} />
        </button>
        <button
          className="h-full px-1.5 flex items-center justify-center hover:bg-[var(--t-bg-card-hover)] transition-colors text-[var(--t-text-dim)] hover:text-[var(--t-status-error)]"
          title="Close pane"
          onClick={handleClosePane}
        >
          <Icon icon="lucide:x" width={14} />
        </button>
      </div>
      {pos && <ContextMenu items={menuItems} pos={pos} onClose={close} />}

      {/* System info popover — portal to escape overflow-hidden pane */}
      {showDistroInfo && distroRect && showDistroPopover && createPortal(
        <div style={{ ...tooltipStyle, top: distroRect.bottom + 6, left: distroRect.left, display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
          <Icon
            icon={icon}
            width={22}
            style={{
              color: session.type === "local" ? localSystemColor(localOsName) : getDistroColor(connection?.distro ?? "linux"),
              flexShrink: 0,
            }}
          />
          {copiedDistro ? (
            <span style={{ color: "var(--t-text-primary)", fontSize: 11 }}>Copied!</span>
          ) : session.type === "local" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ color: "var(--t-text-primary)", fontSize: 11 }}>
                {localSystemLabel(localSystemInfo)}
              </span>
              {localSystemInfo?.kernel_version ? (
                <span style={{ color: "var(--t-text-dim)", fontSize: 10 }}>{localSystemInfo.kernel_version} · {localSystemInfo.arch}</span>
              ) : !localSystemInfo ? (
                <span style={{ color: "var(--t-text-dim)", fontSize: 10 }}>loading…</span>
              ) : null}
              {localSystemInfo?.host_name && (
                <span style={{ color: "var(--t-text-dim)", fontSize: 10 }}>{localSystemInfo.host_name}</span>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ color: "var(--t-text-primary)", fontSize: 11 }}>
                {systemInfo?.pretty_name || getDistroLabel(connection!.distro!)}
              </span>
              {systemInfo?.kernel ? (
                <span style={{ color: "var(--t-text-dim)", fontSize: 10 }}>{systemInfo.kernel} · {systemInfo.arch}</span>
              ) : !systemInfo ? (
                <span style={{ color: "var(--t-text-dim)", fontSize: 10 }}>loading…</span>
              ) : null}
            </div>
          )}
        </div>,
        document.body,
      )}

      {/* Latency sparkline popover — portal to escape overflow-hidden pane */}
      {showSparkline && latencyRect && sparklineSnapshot.length >= 2 && createPortal(
        <div style={{ ...tooltipStyle, top: latencyRect.bottom + 6, left: latencyRect.left }}>
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
          <div style={{ marginTop: 4, display: "flex", gap: 8, color: "var(--t-text-dim)", fontSize: 10, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            <span>min {spMin}ms</span>
            <span>avg {spAvg}ms</span>
            <span>max {spMax}ms</span>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
