import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { useTransferQueueStore } from "@/stores/transferQueueStore";
import { useBackInterceptor } from "@/hooks/useBackInterceptor";
import { type FileEntry, type ConflictResolution, formatSize } from "./SFTPTypes";

export function ConflictDialog({ conflict, conflictNumber, totalConflicts, onResolve }: {
  conflict: FileEntry;
  conflictNumber: number;
  totalConflicts: number;
  onResolve: (r: ConflictResolution) => void;
}) {
  const { t } = useTranslation();
  const hasMore = totalConflicts > 1;

  return (
    <Modal onClose={() => onResolve("cancel")}>
      <ModalCard className="relative z-10 flex flex-col overflow-hidden w-[26.667rem] max-w-[90vw]">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-b-(--t-border)">
          <div
            className="flex items-center justify-center rounded-lg shrink-0 w-[2.133rem] h-[2.133rem]"
            style={{ background: "color-mix(in srgb, #f59e0b 18%, transparent)" }}
          >
            <Icon icon="lucide:triangle-alert" width={16} className="text-[#f59e0b]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-(--t-text-primary)">{t("fileTransfer.conflict.title")}</p>
            {hasMore && (
              <p className="text-xs text-(--t-text-dim)">
                {t("fileTransfer.conflict.conflictOf", { number: conflictNumber, total: totalConflicts })}
              </p>
            )}
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-(--t-bg-elevated) border border-(--t-border)">
            <Icon icon={conflict.isDir ? "lucide:folder" : "lucide:file"} width={18} className="shrink-0" style={{ color: conflict.isDir ? "#f0c050" : "var(--t-text-dim)" }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-(--t-text-primary)">{conflict.name}</p>
              {!conflict.isDir && <p className="text-xs text-(--t-text-dim)">{formatSize(conflict.size)}</p>}
            </div>
          </div>
          <p className="text-xs mt-2 text-(--t-text-dim)">
            {t("fileTransfer.conflict.description")}
          </p>
        </div>

        <div className="flex items-center gap-2 px-5 py-4 flex-wrap border-t border-t-(--t-border)">
          <button
            onClick={() => onResolve("cancel")}
            className="btn btn-ghost px-3 py-1.5 rounded-lg text-xs"
          >
            {t("common.action.cancel")}
          </button>
          <div className="flex-1" />
          <button
            onClick={() => onResolve("skip")}
            className="btn btn-secondary px-3 py-1.5 rounded-lg text-xs"
          >
            {t("fileTransfer.conflict.skip")}
          </button>
          {hasMore && (
            <button
              onClick={() => onResolve("skip-all")}
              className="btn btn-secondary px-3 py-1.5 rounded-lg text-xs"
            >
              {t("fileTransfer.conflict.skipAll")}
            </button>
          )}
          <button
            onClick={() => onResolve("overwrite")}
            className="btn btn-primary px-3 py-1.5 rounded-lg text-xs font-medium"
          >
            {t("fileTransfer.conflict.overwrite")}
          </button>
          {hasMore && (
            <button
              onClick={() => onResolve("overwrite-all")}
              className="btn btn-primary px-3 py-1.5 rounded-lg text-xs font-medium"
            >
              {t("fileTransfer.conflict.overwriteAll")}
            </button>
          )}
        </div>
      </ModalCard>
    </Modal>
  );
}

export function PendingConflictDialog() {
  const pending = useTransferQueueStore((s) => s.pending);
  const resolvePending = useTransferQueueStore((s) => s.resolvePending);
  useBackInterceptor(!!pending, () => resolvePending("cancel"));
  if (!pending) return null;
  return (
    <ConflictDialog
      conflict={pending.conflicts[0]}
      conflictNumber={pending.totalConflicts - pending.conflicts.length + 1}
      totalConflicts={pending.totalConflicts}
      onResolve={resolvePending}
    />
  );
}
