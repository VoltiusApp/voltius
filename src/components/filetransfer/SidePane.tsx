import { useState, useRef, useCallback } from "react";
import { Icon } from "@iconify/react";
import { getDistroIcon, getDistroColor } from "@/utils/icons";
import { type HostChoice, type SidePhase, type FileEntry } from "./SFTPTypes";
import { HostPickerPanel } from "@/components/shared/HostPickerPanel";
import { FilePane } from "./FilePane";
import ConnectionOverlay, { SFTP_STEPS } from "@/components/terminal/ConnectionOverlay";
import { FilterInput } from "@/components/shared/ToolbarViewControls";

export function SidePane({
  host, phase, refreshTick,
  onPick, onNavigate, onSelect, onRefresh, onChangeHost, side, onDropFiles,
  onTransferToTarget, canTransferToTarget, onOpenInTerminal,
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
  onDropFiles: (files: FileEntry[], fromSide: "left" | "right", targetFolder?: string) => void;
  onTransferToTarget?: (files: FileEntry[]) => void;
  canTransferToTarget?: boolean;
  onOpenInTerminal?: (path: string) => void;
}) {
  const hostLabel =
    host == null ? null
    : host.kind === "local" ? "Local Machine"
    : host.connection.name?.trim() || `${host.connection.username}@${host.connection.host}`;

  const hostIcon =
    host?.kind === "local" ? "lucide:monitor"
    : host?.kind === "remote" && host.connection.distro ? (getDistroIcon(host.connection.distro) ?? "lucide:server")
    : "lucide:server";

  const avatarBg =
    host?.kind === "remote" && host.connection.distro
      ? (getDistroColor(host.connection.distro) ?? "var(--t-bg-card-avatar)")
      : "var(--t-bg-card-avatar)";

  const canChangeHost = phase.tag === "connected" || phase.tag === "error";

  const [filterQuery, setFilterQuery] = useState("");
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuOpener, setMenuOpener] = useState<((el: HTMLElement) => void) | null>(null);

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
    <div className="flex flex-col h-full min-w-0 bg-[var(--t-bg-base)]" onMouseDown={handleMouseDown}>

      {/* Toolbar row — host card + filter + menu */}
      <div className="flex items-center gap-2 px-2 py-1.5 shrink-0 border-b border-b-[var(--t-border)] bg-[var(--t-bg-card)]">
        <button
          onClick={canChangeHost ? onChangeHost : undefined}
          className={`flex items-center gap-1.5 px-1.5 py-1 rounded-lg transition-all bg-[var(--t-bg-elevated)] border border-[var(--t-border)] ${canChangeHost ? "cursor-pointer" : "cursor-default"}`}
          onMouseEnter={(e) => { if (canChangeHost) { e.currentTarget.style.borderColor = "var(--t-border-hover)"; e.currentTarget.style.background = "var(--t-bg-card-hover)"; } }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--t-border)"; e.currentTarget.style.background = "var(--t-bg-elevated)"; }}
        >
          <div
            className="rounded-md flex items-center justify-center shrink-0 text-white"
            style={{ width: "1.333rem", height: "1.333rem", background: host ? avatarBg : "var(--t-bg-input)" }}
          >
            {phase.tag === "connecting"
              ? <Icon icon="lucide:loader-2" width={11} className="animate-spin" />
              : <Icon icon={hostIcon} width={11} />
            }
          </div>
          <span className="text-xs font-medium pr-0.5" style={{ color: hostLabel ? "var(--t-text-primary)" : "var(--t-text-dim)" }}>
            {hostLabel ?? "Choose host…"}
          </span>
        </button>

        {phase.tag === "connected" && (
          <div className="ml-auto flex items-center gap-1">
            <NavBtn icon="lucide:arrow-left"  title="Back"    disabled={!histState.canBack}    onClick={goBack} />
            <NavBtn icon="lucide:arrow-right" title="Forward" disabled={!histState.canForward} onClick={goForward} />
            <FilterInput value={filterQuery} onChange={setFilterQuery} placeholder="Filter…" width={96} />
            <button
              ref={menuBtnRef}
              title="More options"
              onClick={() => menuBtnRef.current && menuOpener?.(menuBtnRef.current)}
              className="flex items-center justify-center w-6 h-6 rounded-md shrink-0 transition-colors text-[var(--t-text-dim)]"
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
        {phase.tag === "picking" && <HostPickerPanel onPick={onPick} />}

        {phase.tag === "connecting" && (() => {
          const h = phase.host;
          const phaseIcon = h.kind === "local" ? "lucide:monitor"
            : h.kind === "remote" && h.connection.distro ? (getDistroIcon(h.connection.distro) ?? "lucide:server")
            : "lucide:server";
          const phaseName = h.kind === "local" ? "Local Machine"
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
              steps={SFTP_STEPS}
              stepEventName={`sftp-step-${phase.connectId}`}
              conflictEventName={`sftp-host-key-conflict-${phase.connectId}`}
              className="flex items-center justify-center h-full bg-[var(--t-bg-base)]"
            />
          );
        })()}

        {phase.tag === "error" && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <Icon icon="lucide:wifi-off" width={24} className="text-[var(--t-status-error)]" />
            <p className="text-sm text-[var(--t-status-error)]">{phase.message}</p>
            <button
              onClick={onChangeHost}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors bg-[var(--t-bg-elevated)] text-[var(--t-text-secondary)] border border-[var(--t-border)]"
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
            >
              Try again
            </button>
          </div>
        )}

        {phase.tag === "connected" && host && (
          <FilePane
            sftpId={phase.sftpId}
            isLocal={host.kind === "local"}
            cwd={phase.cwd}
            homeCwd={homeCwdRef.current || undefined}
            onNavigate={navigate}
            onSelect={onSelect}
            onRefresh={onRefresh}
            refreshTick={refreshTick}
            side={side}
            onDropFiles={onDropFiles}
            onTransferToTarget={onTransferToTarget}
            canTransferToTarget={canTransferToTarget ?? false}
            onChangeHost={() => { setFilterQuery(""); setMenuOpener(null); onChangeHost(); }}
            filter={filterQuery}
            onRegisterMenuOpener={(opener) => setMenuOpener(() => opener)}
            onOpenInTerminal={onOpenInTerminal}
          />
        )}
      </div>
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
