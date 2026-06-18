import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useSftpDir } from "@/services/useSftpDir";
import { buildTransferTargets } from "@/services/sftpTransferCore";
import { sftpTransfer, sftpTransferDir } from "@/services/sftp";
import { useTransferQueueStore } from "@/stores/transferQueueStore";
import { formatTransferProgress, type FileEntry } from "@/components/filetransfer/SFTPTypes";
import MobilePanelHeader from "./MobilePanelHeader";
import MobileSftpPane from "./MobileSftpPane";
import SftpHostPickerSheet from "../sheets/SftpHostPickerSheet";

type PaneId = "a" | "b";

export default function MobileSftpScreen({ presetConnectionId, asTab }: { presetConnectionId?: string; asTab?: boolean }) {
  const connections = useAllConnections();
  const runTransfer = useTransferQueueStore((s) => s.runTransfer);
  const transfers = useTransferQueueStore((s) => s.transfers);
  const cancelTransfer = useTransferQueueStore((s) => s.cancelTransfer);
  const active = transfers.filter((t) => t.status === "running");

  const [connAId, setConnAId] = useState<string | undefined>(presetConnectionId);
  const [connBId, setConnBId] = useState<string | undefined>(undefined);
  const [selA, setSelA] = useState<FileEntry[]>([]);
  const [selB, setSelB] = useState<FileEntry[]>([]);
  const [picking, setPicking] = useState<PaneId | null>(null);

  const connA = useMemo(() => connections.find((c) => c.id === connAId), [connections, connAId]);
  const connB = useMemo(() => connections.find((c) => c.id === connBId), [connections, connBId]);
  const ctrlA = useSftpDir(connA);
  const ctrlB = useSftpDir(connB);

  const toggle = (paneId: PaneId, f: FileEntry) => {
    const setSel = paneId === "a" ? setSelA : setSelB;
    setSel((prev) => (prev.some((x) => x.path === f.path) ? prev.filter((x) => x.path !== f.path) : [...prev, f]));
  };

  const copy = async (from: PaneId, items: FileEntry[]) => {
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
    if (ok > 0) (from === "a" ? setSelA : setSelB)([]);
    dst.refresh();
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <MobilePanelHeader title="SFTP" hideBack={asTab} />
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 flex flex-col">
          <MobileSftpPane controller={ctrlA} connection={connA} selected={selA}
            onToggleSelect={(f) => toggle("a", f)} onPickHost={() => setPicking("a")}
            onCopyToOther={(f) => void copy("a", [f])} otherConnected={ctrlB.sftpId != null}
            onClearSelect={() => setSelA([])} />
        </div>
        {/* Middle transfer bar: ↓ copies top→bottom, ↑ copies bottom→top; disabled when N/A */}
        <div className="shrink-0 flex items-center justify-center gap-3 px-3 py-1.5 border-y" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-chrome)" }}>
          <TransferArrow dir="down" count={selA.length} enabled={selA.length > 0 && ctrlB.sftpId != null} onTap={() => void copy("a", selA)} />
          <TransferArrow dir="up" count={selB.length} enabled={selB.length > 0 && ctrlA.sftpId != null} onTap={() => void copy("b", selB)} />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <MobileSftpPane controller={ctrlB} connection={connB} selected={selB}
            onToggleSelect={(f) => toggle("b", f)} onPickHost={() => setPicking("b")}
            onCopyToOther={(f) => void copy("b", [f])} otherConnected={ctrlA.sftpId != null}
            onClearSelect={() => setSelB([])} />
        </div>
      </div>

      {active.length > 0 && (
        <div className="absolute left-0 right-0 bottom-0 px-3 pb-3 flex flex-col gap-1.5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
          {active.map((t) => {
            const pct = t.total > 0 ? Math.round((t.transferred / t.total) * 100) : 0;
            return (
              <div key={t.id} data-sftp-transfer={t.id} className="rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}>
                <Icon icon={t.direction === "←" ? "lucide:download" : "lucide:arrow-right-left"} width={14} className="text-(--t-text-dim) shrink-0" />
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs text-(--t-text-primary) truncate">{t.label}</span>
                  <div className="h-1 rounded-full mt-1 overflow-hidden" style={{ background: "var(--t-bg-card)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--t-accent)" }} />
                  </div>
                  <span data-sftp-transfer-meta className="text-[10px] text-(--t-text-dim) tabular-nums truncate mt-0.5">{formatTransferProgress(t)}</span>
                </span>
                <span className="text-[11px] text-(--t-text-dim) tabular-nums shrink-0">{pct}%</span>
                <button data-sftp-transfer-cancel={t.id} onClick={() => cancelTransfer(t.id)} className="p-1 text-(--t-text-dim) shrink-0"><Icon icon="lucide:x" width={14} /></button>
              </div>
            );
          })}
        </div>
      )}

      {picking && (
        <SftpHostPickerSheet
          excludeId={picking === "a" ? connBId : connAId}
          onClose={() => setPicking(null)}
          onPick={(id) => { if (picking === "a") { setConnAId(id); setSelA([]); } else { setConnBId(id); setSelB([]); } setPicking(null); }}
        />
      )}
    </div>
  );
}

function TransferArrow({ dir, count, enabled, onTap }: { dir: "up" | "down"; count: number; enabled: boolean; onTap: () => void }) {
  return (
    <button data-sftp-copy={dir === "down" ? "a" : "b"} disabled={!enabled} onClick={onTap}
      className="flex items-center gap-1.5 px-6 py-1.5 rounded-xl text-sm font-medium"
      style={{ background: enabled ? "var(--t-accent)" : "var(--t-bg-card)", color: enabled ? "#fff" : "var(--t-text-dim)", opacity: enabled ? 1 : 0.45 }}>
      <Icon icon={dir === "down" ? "lucide:arrow-down" : "lucide:arrow-up"} width={18} />
      {count > 0 && <span className="tabular-nums">{count}</span>}
    </button>
  );
}
