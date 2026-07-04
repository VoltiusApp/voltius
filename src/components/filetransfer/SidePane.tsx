import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { getConnectionIcon, getConnectionIconColor } from "@/utils/icons";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { type HostChoice, type SidePhase, type FileEntry } from "./SFTPTypes";
import { HostPickerPanel } from "@/components/shared/HostPickerPanel";
import { FilePane } from "./FilePane";
import ConnectionOverlay, { getSftpSteps } from "@/components/terminal/connection-overlay";
import { FilterInput } from "@/components/shared/ToolbarViewControls";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { useAllConnections } from "@/hooks/useAllConnections";

function latencyColor(ms: number): string {
  if (ms < 50) return "var(--t-status-connected)";
  if (ms < 150) return "var(--t-status-warning)";
  return "var(--t-status-error)";
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

export function SidePane({
  host, phase, refreshTick,
  onPick, onNavigate, onSelect, onRefresh, onChangeHost, side, onDropFiles,
  onTransferToTarget, canTransferToTarget, onOpenInTerminal,
  selected = [], onUpload, onDownloadFiles, onMoveWithin,
}: {
  host: HostChoice | null;
  phase: SidePhase;
  refreshTick: number;
  onPick: (h: HostChoice) => void;
  onNavigate: (p: string) => void;
  onSelect: (files: FileEntry[]) => void;
  onRefresh: () => void;
  onChangeHost: () => void;
  side: "left" | "right";
  onDropFiles: (files: FileEntry[], fromSide: "left" | "right" | "panel", targetFolder?: string) => void;
  onTransferToTarget?: (files: FileEntry[]) => void;
  canTransferToTarget?: boolean;
  onOpenInTerminal?: (path: string) => void;
  /** Current selection in this pane (drives the download button's enabled state). */
  selected?: FileEntry[];
  /** Pick local files and upload them into this pane's cwd. */
  onUpload?: () => void;
  /** Download the given remote files to a chosen local folder (remote panes only). */
  onDownloadFiles?: (files: FileEntry[]) => void;
  onMoveWithin?: (files: FileEntry[], targetFolder: string) => void;
}) {
  const { t } = useTranslation();
  const hostLabel =
    host == null ? null
    : host.kind === "local" ? (host.wslDistro ?? t("fileTransfer.common.localMachine"))
    : host.connection.name?.trim() || `${host.connection.username}@${host.connection.host}`;

  const hostIcon =
    host?.kind === "local" ? (host.wslDistro ? getConnectionIcon(host.wslDistro.split(/[-_ ]/)[0]) : "lucide:monitor")
    : host?.kind === "remote" && (host.connection.icon || host.connection.distro) ? (getConnectionIcon(host.connection.icon || host.connection.distro!) ?? "lucide:server")
    : "lucide:server";

  const avatarBg =
    host?.kind === "local" && host.wslDistro
      ? (getConnectionIconColor(host.wslDistro.split(/[-_ ]/)[0]) ?? "var(--t-bg-card-avatar)")
      : host?.kind === "remote" && (host.connection.icon || host.connection.distro)
      ? (getConnectionIconColor(host.connection.icon || host.connection.distro!) ?? "var(--t-bg-card-avatar)")
      : "var(--t-bg-card-avatar)";

  const canChangeHost = phase.tag === "connected" || phase.tag === "error";

  const [filterQuery, setFilterQuery] = useState("");
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const viewBtnRef = useRef<HTMLButtonElement>(null);
  const [menuOpener, setMenuOpener] = useState<((el: HTMLElement) => void) | null>(null);
  const [viewMenuOpener, setViewMenuOpener] = useState<((el: HTMLElement) => void) | null>(null);

  // ── Latency / ping ──────────────────────────────────────────────────────────
  const connectionId = host?.kind === "remote" ? host.connection.id : undefined;
  const connections = useAllConnections();
  const connection = connectionId ? connections.find((c) => c.id === connectionId) : undefined;
  const [pingEnabled] = useToggle("reachability");
  const activePollIntervalMs = useHostPingStore((s) => s.activePollIntervalMs);
  const setStatus = useHostPingStore((s) => s.setStatus);
  const pingStatus = useHostPingStore((s) => connectionId ? s.statuses[connectionId] : undefined);
  const latencyMs = useHostPingStore((s) => connectionId ? s.latencies[connectionId] : undefined);

  const latencyHistoryRef = useRef<number[]>([]);
  const [showSparkline, setShowSparkline] = useState(false);
  const [sparklineSnapshot, setSparklineSnapshot] = useState<number[]>([]);
  const latencyTriggerRef = useRef<HTMLDivElement>(null);
  const [latencyRect, setLatencyRect] = useState<DOMRect | null>(null);

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
    if (!pingEnabled || !connectionId || !connection) return;
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
  }, [pingEnabled, connectionId, connection, activePollIntervalMs, setStatus]);

  // ── Navigation history ──────────────────────────────────────────────────────
  const historyRef = useRef<string[]>([]);
  const histIdxRef = useRef<number>(-1);
  const [histState, setHistState] = useState({ canBack: false, canForward: false });
  const homeCwdRef = useRef<string>("");

  // Reset history when a new connection becomes "connected"
  const prevPhaseTagRef = useRef<string>("");
  if (phase.tag === "connected" && prevPhaseTagRef.current !== "connected") {
    historyRef.current = [phase.cwd];
    histIdxRef.current = 0;
    homeCwdRef.current = phase.cwd;
    setHistState({ canBack: false, canForward: false });
  }
  prevPhaseTagRef.current = phase.tag;

  const navigate = useCallback((p: string) => {
    const hist = historyRef.current;
    const idx = histIdxRef.current;
    // Truncate forward history, push new entry
    historyRef.current = [...hist.slice(0, idx + 1), p];
    histIdxRef.current = historyRef.current.length - 1;
    setHistState({ canBack: histIdxRef.current > 0, canForward: false });
    onNavigate(p);
  }, [onNavigate]);

  const goBack = useCallback(() => {
    const idx = histIdxRef.current;
    if (idx <= 0) return;
    histIdxRef.current = idx - 1;
    const p = historyRef.current[histIdxRef.current];
    setHistState({ canBack: histIdxRef.current > 0, canForward: true });
    onNavigate(p);
  }, [onNavigate]);

  const goForward = useCallback(() => {
    const idx = histIdxRef.current;
    if (idx >= historyRef.current.length - 1) return;
    histIdxRef.current = idx + 1;
    const p = historyRef.current[histIdxRef.current];
    setHistState({ canBack: true, canForward: histIdxRef.current < historyRef.current.length - 1 });
    onNavigate(p);
  }, [onNavigate]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 3) { e.preventDefault(); goBack(); }
    else if (e.button === 4) { e.preventDefault(); goForward(); }
  }, [goBack, goForward]);

  return (
    <div className="flex flex-col h-full min-w-0 bg-(--t-bg-card)" onMouseDown={handleMouseDown}>

      {/* Toolbar row — host card + filter + menu */}
      <div className="flex items-center gap-2 px-2 py-2 shrink-0 border-b border-b-(--t-border) bg-(--t-bg-card)">
        <button
          onClick={canChangeHost ? onChangeHost : undefined}
          className={`flex items-center gap-1.5 px-1.5 py-1 rounded-lg transition-all bg-(--t-bg-elevated) border border-(--t-border) ${canChangeHost ? "cursor-pointer" : "cursor-default"}`}
          onMouseEnter={(e) => { if (canChangeHost) { e.currentTarget.style.borderColor = "var(--t-border-hover)"; e.currentTarget.style.background = "var(--t-bg-card-hover)"; } }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--t-border)"; e.currentTarget.style.background = "var(--t-bg-elevated)"; }}
        >
          <AvatarTile
            base={host ? avatarBg : undefined}
            className="rounded-md text-white"
            style={{ width: "1.333rem", height: "1.333rem", ...(host ? {} : { background: "var(--t-bg-input)", boxShadow: "none" }) }}
          >
            {phase.tag === "connecting"
              ? <Icon icon="lucide:loader-circle" width={11} className="animate-spin" />
              : <Icon icon={hostIcon} width={11} />
            }
          </AvatarTile>
          <span className="text-xs font-medium pr-0.5" style={{ color: hostLabel ? "var(--t-text-primary)" : "var(--t-text-dim)" }}>
            {hostLabel ?? t("fileTransfer.side.chooseHost")}
          </span>
        </button>

        {phase.tag === "connected" && pingStatus === "up" && latencyMs !== undefined && (
          <div
            ref={latencyTriggerRef}
            className="flex items-center gap-1 px-1 cursor-default"
            style={{ fontSize: 11 }}
            onMouseEnter={() => { if (latencyTriggerRef.current) setLatencyRect(latencyTriggerRef.current.getBoundingClientRect()); setShowSparkline(true); }}
            onMouseLeave={() => setShowSparkline(false)}
            title={`${latencyMs}ms`}
          >
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: latencyColor(latencyMs), flexShrink: 0, transition: "background 0.4s" }} />
            <span style={{ color: latencyColor(latencyMs), fontVariantNumeric: "tabular-nums" }}>{latencyMs}ms</span>
          </div>
        )}

        {phase.tag === "connected" && (
          <div className="ml-auto flex items-center gap-1">
            <NavBtn icon="lucide:arrow-left"  title={t("fileTransfer.side.back")}    disabled={!histState.canBack}    onClick={goBack} />
            <NavBtn icon="lucide:arrow-right" title={t("fileTransfer.side.forward")} disabled={!histState.canForward} onClick={goForward} />
            <FilterInput value={filterQuery} onChange={setFilterQuery} placeholder={t("fileTransfer.side.filterPlaceholder")} width={128} shortcutId="filter" />
            {onUpload && (
              <NavBtn icon="lucide:upload" title={t("fileTransfer.side.uploadHere")} disabled={false} onClick={onUpload} />
            )}
            {onDownloadFiles && (
              <NavBtn
                icon="lucide:download"
                title={selected.length > 0
                  ? t("fileTransfer.side.download", { count: selected.length, name: selected[0]?.name })
                  : t("fileTransfer.side.selectFilesToDownload")}
                disabled={selected.length === 0}
                onClick={() => onDownloadFiles(selected)}
              />
            )}
            <button
              ref={viewBtnRef}
              title={t("fileTransfer.side.viewOptions")}
              onClick={() => viewBtnRef.current && viewMenuOpener?.(viewBtnRef.current)}
              className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-colors text-(--t-text-dim)"
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-elevated)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
            >
              <Icon icon="lucide:layout-list" width={14} />
            </button>
            <button
              ref={menuBtnRef}
              title={t("fileTransfer.side.moreOptions")}
              onClick={() => menuBtnRef.current && menuOpener?.(menuBtnRef.current)}
              className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-colors text-(--t-text-dim)"
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-elevated)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
            >
              <Icon icon="lucide:ellipsis-vertical" width={14} />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {phase.tag === "picking" && <HostPickerPanel onPick={onPick} sshOnly />}

        {phase.tag === "connecting" && (() => {
          const h = phase.host;
          const phaseIcon = h.kind === "local" ? (h.wslDistro ? getConnectionIcon(h.wslDistro.split(/[-_ ]/)[0]) : "lucide:monitor")
            : h.kind === "remote" && (h.connection.icon || h.connection.distro) ? (getConnectionIcon(h.connection.icon || h.connection.distro!) ?? "lucide:server")
            : "lucide:server";
          const phaseName = h.kind === "local" ? (h.wslDistro ?? t("fileTransfer.common.localMachine"))
            : h.connection.name?.trim() || `${h.connection.username}@${h.connection.host}`;
          const phaseSubtitle = h.kind === "remote"
            ? `${h.connection.username}@${h.connection.host}:${h.connection.port}`
            : undefined;
          return (
            <ConnectionOverlay
              sessionId={phase.connectId}
              status="connecting"
              name={phaseName}
              subtitle={phaseSubtitle}
              icon={phaseIcon}
              steps={getSftpSteps()}
              stepEventName={`sftp-step-${phase.connectId}`}
              conflictEventName={`sftp-host-key-conflict-${phase.connectId}`}
              className="flex items-center justify-center h-full bg-(--t-bg-base)"
            />
          );
        })()}

        {phase.tag === "error" && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <Icon icon="lucide:wifi-off" width={24} className="text-(--t-status-error)" />
            <p className="text-sm text-(--t-status-error)">{phase.message}</p>
            <button
              onClick={onChangeHost}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors bg-(--t-bg-elevated) text-(--t-text-secondary) border border-(--t-border)"
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
            >
              {t("fileTransfer.side.tryAgain")}
            </button>
          </div>
        )}

        {phase.tag === "connected" && host && (
          <FilePane
            sftpId={phase.sftpId}
            isLocal={host.kind === "local"}
            cwd={phase.cwd}
            homeCwd={homeCwdRef.current || undefined}
            hostLabel={hostLabel ?? t("fileTransfer.common.remoteFallback")}
            onNavigate={navigate}
            onSelect={onSelect}
            onRefresh={onRefresh}
            refreshTick={refreshTick}
            side={side}
            onDropFiles={onDropFiles}
            onTransferToTarget={onTransferToTarget}
            canTransferToTarget={canTransferToTarget ?? false}
            onChangeHost={() => { setFilterQuery(""); setMenuOpener(null); setViewMenuOpener(null); onChangeHost(); }}
            filter={filterQuery}
            onRegisterMenuOpener={(opener) => setMenuOpener(() => opener)}
            onRegisterViewMenuOpener={(opener) => setViewMenuOpener(() => opener)}
            onOpenInTerminal={onOpenInTerminal}
            onPanelUpload={onUpload}
            onPanelDownload={onDownloadFiles}
            onMoveWithin={onMoveWithin}
          />
        )}
      </div>

      {showSparkline && latencyRect && sparklineSnapshot.length >= 2 && createPortal(
        (() => {
          const spMin = Math.min(...sparklineSnapshot);
          const spMax = Math.max(...sparklineSnapshot);
          const spAvg = Math.round(sparklineSnapshot.reduce((a, b) => a + b, 0) / sparklineSnapshot.length);
          const spPoints = sparklinePoints(sparklineSnapshot, 80, 20);
          return (
            <div style={{
              position: "fixed",
              top: latencyRect.bottom + 6,
              left: latencyRect.left,
              background: "var(--t-bg-card)",
              border: "1px solid var(--t-border)",
              borderRadius: 8,
              padding: "8px 10px",
              zIndex: 100,
              boxShadow: "var(--t-elev-1)",
              pointerEvents: "none",
            }}>
              <svg width={80} height={20} style={{ display: "block" }}>
                <polyline points={spPoints} fill="none" stroke={latencyColor(spAvg)} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              <div style={{ marginTop: 4, display: "flex", gap: 8, color: "var(--t-text-dim)", fontSize: 10, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                <span>{t("fileTransfer.side.sparkline.min", { value: spMin })}</span>
                <span>{t("fileTransfer.side.sparkline.avg", { value: spAvg })}</span>
                <span>{t("fileTransfer.side.sparkline.max", { value: spMax })}</span>
              </div>
            </div>
          );
        })(),
        document.body,
      )}
    </div>
  );
}

function NavBtn({ icon, title, disabled, onClick }: { icon: string; title: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-colors"
      style={{ color: disabled ? "var(--t-text-dim)" : "var(--t-text-secondary)", opacity: disabled ? 0.35 : 1, cursor: disabled ? "default" : "pointer" }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--t-bg-elevated)"; e.currentTarget.style.color = "var(--t-text-primary)"; } }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = disabled ? "var(--t-text-dim)" : "var(--t-text-secondary)"; }}
    >
      <Icon icon={icon} width={13} />
    </button>
  );
}
