import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useSftpDir } from "@/services/useSftpDir";
import { buildTransferTargets } from "@/services/sftpTransferCore";
import { sftpTransfer, sftpTransferDir } from "@/services/sftp";
import type { Connection } from "@/types";
import { isSshConnection } from "@/services/credentialScope";
import { useTransferQueueStore } from "@/stores/transferQueueStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { formatTransferProgress, type FileEntry } from "@/components/filetransfer/SFTPTypes";
import MobilePanelHeader from "./MobilePanelHeader";
import MobileSftpPane from "./MobileSftpPane";
import SftpHostPickerSheet from "../sheets/SftpHostPickerSheet";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { PendingConflictDialog } from "@/components/filetransfer/ConflictDialog";
import { NO_SELECTION, paneItems, setPaneSelection, type SftpPaneId, type SftpPaneTarget, type SftpSelection } from "./sftpSelectionCore";

/**
 * Mobile SFTP: one remote pane by default; the top-bar toggle (remembered) adds the second
 * pane and the copy bar between them. Long-press a row for selection mode: its contextual
 * bar replaces the top bar (the owning pane portals it into the header slot).
 * `visible` = this screen is on screen (the SFTP tab stays mounted while hidden); it gates
 * the panes' Back handlers.
 */
export default function MobileSftpScreen({ presetConnectionId, asTab, visible = true }: { presetConnectionId?: string; asTab?: boolean; visible?: boolean }) {
  const { t } = useTranslation();
  const connections = useAllConnections();
  const runTransfer = useTransferQueueStore((s) => s.runTransfer);
  const transfers = useTransferQueueStore((s) => s.transfers);
  const cancelTransfer = useTransferQueueStore((s) => s.cancelTransfer);
  const canRetry = useTransferQueueStore((s) => s.canRetry);
  const retryTransfer = useTransferQueueStore((s) => s.retryTransfer);
  const twoPanes = useUIStore((s) => s.mobileSftpTwoPanes);
  const toggleTwoPanes = useUIStore((s) => s.toggleMobileSftpTwoPanes);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const active = transfers.filter(
    (t) => (t.status === "running" || t.status === "error") && !dismissed.includes(t.id),
  );

  const [targetA, setTargetA] = useState<SftpPaneTarget | undefined>(presetConnectionId ? { kind: "connection", id: presetConnectionId } : undefined);
  const [targetB, setTargetB] = useState<SftpPaneTarget | undefined>(undefined);
  const connAId = targetA?.kind === "connection" ? targetA.id : undefined;
  const connBId = targetB?.kind === "connection" ? targetB.id : undefined;
  const [sel, setSel] = useState<SftpSelection>(NO_SELECTION);
  const [picking, setPicking] = useState<SftpPaneId | null>(null);
  // The pane Back navigates up in: the one last touched (always "a" with one pane).
  const [focused, setFocused] = useState<SftpPaneId>("a");
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const backPane: SftpPaneId = twoPanes ? focused : "a";

  const connA = useMemo(() => connections.find((c) => c.id === connAId), [connections, connAId]);
  const connB = useMemo(() => connections.find((c) => c.id === connBId), [connections, connBId]);
  const dirTarget = (t: SftpPaneTarget | undefined, conn: Connection | undefined) => (t?.kind === "device" ? { device: t.device } : conn);
  const ctrlA = useSftpDir(dirTarget(targetA, connA));
  const ctrlB = useSftpDir(dirTarget(targetB, connB));

  // The SFTP tab opens on the current terminal session's host when nothing is picked yet.
  const activeConnId = useSessionStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.connectionId);
  useEffect(() => {
    if (!asTab || !visible || targetA || !activeConnId) return;
    const c = connections.find((x) => x.id === activeConnId);
    if (c && isSshConnection(c)) setTargetA({ kind: "connection", id: c.id });
  }, [asTab, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back to one pane: pane b's selection goes with it.
  useEffect(() => { if (!twoPanes) setSel((s) => (s.pane === "b" ? NO_SELECTION : s)); }, [twoPanes]);

  const selA = paneItems(sel, "a");
  const selB = paneItems(sel, "b");

  const copy = async (from: SftpPaneId, items: FileEntry[]) => {
    const src = from === "a" ? ctrlA : ctrlB;
    const dst = from === "a" ? ctrlB : ctrlA;
    if (!src.sftpId || !dst.sftpId || items.length === 0) return;
    const targets = buildTransferTargets(items, dst.cwd);
    let ok = 0;
    for (const t of targets) {
      await runTransfer(t.name, "→", (tid) => (t.isDir
        ? sftpTransferDir({ srcSftpId: src.sftpId!, srcPath: t.srcPath, dstSftpId: dst.sftpId!, dstPath: t.dstPath, transferId: tid })
        : sftpTransfer({ srcSftpId: src.sftpId!, srcPath: t.srcPath, dstSftpId: dst.sftpId!, dstPath: t.dstPath, transferId: tid })),
        () => { ok++; }); // onDone fires only on success — keep selection if all failed
    }
    if (ok > 0) setSel((s) => (s.pane === from ? NO_SELECTION : s));
    dst.refresh();
  };

  const pane = (id: SftpPaneId) => {
    const [ctrl, conn, target, other] = id === "a" ? [ctrlA, connA, targetA, ctrlB] : [ctrlB, connB, targetB, ctrlA];
    return (
      <div className="flex-1 min-h-0 flex flex-col" data-sftp-pane={id} onPointerDown={() => setFocused(id)}>
        <MobileSftpPane controller={ctrl} connection={conn} device={target?.kind === "device" ? target.device : undefined} selected={paneItems(sel, id)}
          onSelectionChange={(items) => setSel(setPaneSelection(id, items))} onPickHost={() => setPicking(id)}
          onCopyToOther={(items) => void copy(id, items)} otherConnected={twoPanes && other.sftpId != null && !other.readOnly}
          headerSlot={headerSlot} onScreen={visible} backUp={visible && backPane === id && sel.pane == null} />
      </div>
    );
  };

  const paneToggleLabel = twoPanes ? t("mobile.sftp.onePane") : t("mobile.sftp.twoPanes");

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)" data-mobile-sftp={twoPanes ? "two" : "one"}>
      {/* Selection mode: the owning pane portals its contextual bar here, in place of the top bar. */}
      <div ref={setHeaderSlot} className="contents" data-sftp-header-slot />
      {sel.pane == null && (
        <MobilePanelHeader title={t("mobile.tabBar.sftp")} hideBack={asTab} right={(
          <span className="flex items-center">
            <button data-sftp-two-panes={twoPanes ? "on" : "off"} aria-pressed={twoPanes} onClick={toggleTwoPanes}
              aria-label={paneToggleLabel} title={paneToggleLabel}
              className="w-12 h-12 flex items-center justify-center rounded-full"
              style={twoPanes
                ? { color: "var(--t-accent)", background: "color-mix(in srgb, var(--t-accent) 16%, transparent)" }
                : { color: "var(--t-text-dim)" }}>
              <Icon icon="lucide:rows-2" width={20} />
            </button>
            <NotificationBell />
          </span>
        )} />
      )}
      <div className="flex-1 min-h-0 flex flex-col">
        {pane("a")}
        {twoPanes && (
          <>
            {/* Middle transfer bar: ↓ copies top→bottom, ↑ copies bottom→top; disabled when N/A */}
            <div className="shrink-0 flex items-center justify-center gap-3 px-3 h-12 border-y" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-chrome)" }}>
              <TransferArrow dir="down" count={selA.length} enabled={selA.length > 0 && ctrlB.sftpId != null} onTap={() => void copy("a", selA)} />
              <TransferArrow dir="up" count={selB.length} enabled={selB.length > 0 && ctrlA.sftpId != null} onTap={() => void copy("b", selB)} />
            </div>
            {pane("b")}
          </>
        )}
      </div>

      {active.length > 0 && (
        <div data-snackbar-anchor className="absolute left-0 right-0 bottom-0 px-3 pb-3 flex flex-col gap-1.5" style={{ paddingBottom: "calc(var(--vt-safe-bottom) + 0.75rem)" }}>
          {active.map((tr) => {
            const pct = tr.total > 0 ? Math.round((tr.transferred / tr.total) * 100) : 0;
            const failed = tr.status === "error";
            return (
              <div key={tr.id} data-sftp-transfer={tr.id} className="rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: "var(--t-bg-elevated)", border: `1px solid ${failed ? "var(--t-status-error)" : "var(--t-border)"}` }}>
                <Icon icon={failed ? "lucide:triangle-alert" : tr.direction === "←" ? "lucide:download" : "lucide:arrow-right-left"} width={14}
                  className="shrink-0" style={{ color: failed ? "var(--t-status-error)" : "var(--t-text-dim)" }} />
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs text-(--t-text-primary) truncate">{tr.label}</span>
                  {failed ? (
                    <span data-sftp-transfer-error className="text-[10px] mt-0.5 break-all" style={{ color: "var(--t-status-error)" }}>{tr.error ?? t("mobile.sftp.transferFailed")}</span>
                  ) : (
                    <>
                      <div className="h-1 rounded-full mt-1 overflow-hidden" style={{ background: "var(--t-bg-card)" }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--t-accent)" }} />
                      </div>
                      <span data-sftp-transfer-meta className="text-[10px] text-(--t-text-dim) tabular-nums truncate mt-0.5">{formatTransferProgress(tr)}</span>
                    </>
                  )}
                </span>
                {!failed && <span className="text-[11px] text-(--t-text-dim) tabular-nums shrink-0">{pct}%</span>}
                {failed && canRetry(tr.id) && (
                  <button data-sftp-transfer-retry={tr.id} onClick={() => { setDismissed((d) => [...d, tr.id]); retryTransfer(tr.id); }}
                    className="vt-hit px-2 py-1 text-xs font-semibold shrink-0" style={{ color: "var(--t-accent)" }}>{t("common.action.retry")}</button>
                )}
                <button data-sftp-transfer-cancel={tr.id} aria-label={failed ? t("common.action.dismiss") : t("common.action.cancel")}
                  onClick={() => (failed ? setDismissed((d) => [...d, tr.id]) : cancelTransfer(tr.id))}
                  className="vt-icon-btn -my-3 -mr-2 text-(--t-text-dim)"><Icon icon="lucide:x" width={14} /></button>
              </div>
            );
          })}
        </div>
      )}

      {picking && (
        <SftpHostPickerSheet
          excludeId={picking === "a" ? connBId : connAId}
          onClose={() => setPicking(null)}
          onPick={(target) => {
            if (picking === "a") setTargetA(target); else setTargetB(target);
            setSel((s) => (s.pane === picking ? NO_SELECTION : s));
            setPicking(null);
          }}
        />
      )}
      <PendingConflictDialog />
    </div>
  );
}

function TransferArrow({ dir, count, enabled, onTap }: { dir: "up" | "down"; count: number; enabled: boolean; onTap: () => void }) {
  return (
    <button data-sftp-copy={dir === "down" ? "a" : "b"} disabled={!enabled} onClick={onTap}
      className="vt-hit flex items-center gap-1.5 px-6 py-1.5 rounded-xl text-sm font-medium"
      style={{ background: enabled ? "var(--t-accent)" : "var(--t-bg-card)", color: enabled ? "#fff" : "var(--t-text-dim)", opacity: enabled ? 1 : 0.45 }}>
      <Icon icon={dir === "down" ? "lucide:arrow-down" : "lucide:arrow-up"} width={18} />
      {count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  );
}
