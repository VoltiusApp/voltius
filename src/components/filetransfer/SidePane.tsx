import { useState, useRef, useCallback, useEffect, useMemo, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { type HostChoice, type SidePhase, type FileEntry } from "./SFTPTypes";
import { HostPickerPanel } from "@/components/shared/HostPickerPanel";
import { FilePane } from "./FilePane";
import ConnectionOverlay, { getDeviceSteps, getSftpSteps } from "@/components/terminal/connection-overlay";
import { FilterInput } from "@/components/shared/ToolbarViewControls";
import { StatusDot } from "@/components/shared/StatusDot";
import { useHostPingStore } from "@/stores/hostPingStore";
import { latencyColor, latencyTone } from "@/utils/statusTone";
import { useToggle } from "@/stores/toggleSettingsStore";
import { isVaultErrorCode } from "@/services/vaultErrors";
import { routeLabel } from "@/services/myDevices";
import { hostPresentation } from "./hostPresentation";
import { useReadOnlyTip } from "@/services/deviceReadOnly";
import { ReadOnlyBadge } from "@/components/shared/ReadOnlyBadge";

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
  selected = [], onUpload, onDownloadFiles, onMoveWithin, onPaste,
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
  onPaste?: (dest: import("@/stores/fileClipboardStore").FileEndpoint) => void;
}) {
  const { t } = useTranslation();
  const shown = host ? hostPresentation(host, t) : null;
  const hostLabel = shown?.name ?? null;
  const readOnlyTip = useReadOnlyTip(phase.tag === "connected" && phase.readOnly, hostLabel);
  const connectingHost = phase.tag === "connecting" ? phase.host : null;
  const connectSteps = useMemo(() => (connectingHost?.kind === "device" ? getDeviceSteps(connectingHost.device.name) : getSftpSteps()), [connectingHost]);
  const overlayHost = (h: HostChoice | null | undefined) => {
    const p = h ? hostPresentation(h, t) : null;
    return { icon: p?.icon ?? "lucide:server", name: p?.name ?? "", subtitle: p?.subtitle };
  };

  // Includes connecting, so a slow or hung connect can be abandoned.
  const canChangeHost = phase.tag !== "picking";

  const [filterQuery, setFilterQuery] = useState("");
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const viewBtnRef = useRef<HTMLButtonElement>(null);
  const [menuOpener, setMenuOpener] = useState<((el: HTMLElement) => void) | null>(null);
  const [viewMenuOpener, setViewMenuOpener] = useState<((el: HTMLElement) => void) | null>(null);

  // ── Latency / ping ──────────────────────────────────────────────────────────
  const connectionId = host?.kind === "remote" ? host.connection.id : undefined;
  const [pingEnabled] = useToggle("reachability");
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
            base={shown?.base}
            className="rounded-md text-white"
            style={{ width: "1.333rem", height: "1.333rem", ...(host ? {} : { background: "var(--t-bg-input)", boxShadow: "none" }) }}
          >
            {phase.tag === "connecting"
              ? <Icon icon="lucide:loader-circle" width={11} className="animate-spin" />
              : <Icon icon={shown?.icon ?? "lucide:server"} width={11} />
            }
          </AvatarTile>
          <span className="text-xs font-medium pr-0.5" style={{ color: hostLabel ? "var(--t-text-primary)" : "var(--t-text-dim)" }}>
            {hostLabel ?? t("fileTransfer.side.chooseHost")}
          </span>
        </button>

        {pingEnabled && phase.tag === "connected" && pingStatus === "up" && latencyMs !== undefined && (
          <LatencyReadout
            ref={latencyTriggerRef}
            ms={latencyMs}
            label={`${latencyMs}ms`}
            onMouseEnter={() => { if (latencyTriggerRef.current) setLatencyRect(latencyTriggerRef.current.getBoundingClientRect()); setShowSparkline(true); }}
            onMouseLeave={() => setShowSparkline(false)}
            title={`${latencyMs}ms`}
          />
        )}

        {phase.tag === "connected" && phase.route && phase.rttMs !== undefined && (
          <LatencyReadout
            data-route-chip
            ms={phase.rttMs}
            label={t("fileTransfer.myDevices.routeChip", { route: routeLabel(t, phase.route), ms: phase.rttMs })}
          />
        )}

        {readOnlyTip && <ReadOnlyBadge tip={readOnlyTip} />}

        {phase.tag === "connected" && (
          <div className="ml-auto flex items-center gap-1">
            <NavBtn icon="lucide:arrow-left"  title={t("fileTransfer.side.back")}    disabled={!histState.canBack}    onClick={goBack} />
            <NavBtn icon="lucide:arrow-right" title={t("fileTransfer.side.forward")} disabled={!histState.canForward} onClick={goForward} />
            <FilterInput value={filterQuery} onChange={setFilterQuery} placeholder={t("fileTransfer.side.filterPlaceholder")} width={128} shortcutId="filter" />
            {onUpload && (
              <NavBtn
                icon="lucide:upload"
                title={readOnlyTip ?? t("fileTransfer.side.uploadHere")}
                disabled={!!phase.readOnly}
                onClick={onUpload}
              />
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
        {phase.tag === "picking" && <HostPickerPanel onPick={onPick} sshOnly devices />}

        {phase.tag === "connecting" && (
          <ConnectionOverlay
            sessionId={phase.connectId}
            status="connecting"
            {...overlayHost(phase.host)}
            steps={connectSteps}
            stepEventName={`sftp-step-${phase.connectId}`}
            conflictEventName={`sftp-host-key-conflict-${phase.connectId}`}
            className="flex items-center justify-center h-full bg-(--t-bg-base)"
          />
        )}

        {/* The vault holds the credentials, so the panel's unlock action is the
            way out; the message alone leaves nothing to act on. */}
        {phase.tag === "error" && isVaultErrorCode(phase.errorCode) && (
          <ConnectionOverlay
            sessionId={`sftp-error-${side}`}
            status="error"
            errorMessage={phase.message}
            errorCode={phase.errorCode}
            {...overlayHost(phase.host ?? host)}
            steps={getSftpSteps()}
            stepEventName={`sftp-step-error-${side}`}
            onRetry={onChangeHost}
            className="flex items-center justify-center h-full bg-(--t-bg-base)"
          />
        )}

        {phase.tag === "error" && !isVaultErrorCode(phase.errorCode) && (
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
            isDevice={host.kind === "device"}
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
            onPaste={onPaste}
            onBack={goBack}
            onForward={goForward}
            canBack={histState.canBack}
            canForward={histState.canForward}
            readOnly={phase.readOnly}
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

function LatencyReadout({ ms, label, ...rest }: { ms: number; label: string } & ComponentProps<"div">) {
  return (
    <div className="flex items-center gap-1 px-1 cursor-default" style={{ fontSize: 11 }} {...rest}>
      <StatusDot tone={latencyTone(ms)} size="sm" />
      <span style={{ color: latencyColor(ms), fontVariantNumeric: "tabular-nums" }}>{label}</span>
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
