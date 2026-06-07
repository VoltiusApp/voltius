import { Icon } from "@iconify/react";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { type FileEntry, type ConflictResolution, formatSize } from "./SFTPTypes";

export function ConflictDialog({ conflict, conflictNumber, totalConflicts, onResolve }: {
  conflict: FileEntry;
  conflictNumber: number;
  totalConflicts: number;
  onResolve: (r: ConflictResolution) => void;
}) {
  const hasMore = totalConflicts > 1;

  return (
    <Modal onClose={() => onResolve("cancel")}>
      <ModalCard className="relative z-10 flex flex-col overflow-hidden w-[26.667rem] max-w-[90vw]">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-b-(--t-border)">
          <div
            className="flex items-center justify-center rounded-lg shrink-0 w-[2.133rem] h-[2.133rem]"
            style={{ background: "color-mix(in srgb, #f59e0b 18%, transparent)" }}
          >
            <Icon icon="lucide:alert-triangle" width={16} className="text-[#f59e0b]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-(--t-text-primary)">File already exists</p>
            {hasMore && (
              <p className="text-xs text-(--t-text-dim)">
                Conflict {conflictNumber} of {totalConflicts}
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
            An item with this name already exists at the destination. What would you like to do?
          </p>
        </div>

        <div className="flex items-center gap-2 px-5 py-4 flex-wrap border-t border-t-(--t-border)">
          <button
            onClick={() => onResolve("cancel")}
            className="px-3 py-1.5 rounded-lg text-xs transition-colors text-(--t-text-secondary) border border-(--t-border)"
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Cancel
          </button>
          <div className="flex-1" />
          <button
            onClick={() => onResolve("skip")}
            className="px-3 py-1.5 rounded-lg text-xs transition-colors bg-(--t-bg-elevated) text-(--t-text-secondary) border border-(--t-border-hover)"
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
          >
            Skip
          </button>
          {hasMore && (
            <button
              onClick={() => onResolve("skip-all")}
              className="px-3 py-1.5 rounded-lg text-xs transition-colors bg-(--t-bg-elevated) text-(--t-text-secondary) border border-(--t-border-hover)"
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
            >
              Skip All
            </button>
          )}
          <button
            onClick={() => onResolve("overwrite")}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-(--t-accent) text-white border border-(--t-accent)"
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            Overwrite
          </button>
          {hasMore && (
            <button
              onClick={() => onResolve("overwrite-all")}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-(--t-accent) text-white border border-(--t-accent)"
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              Overwrite All
            </button>
          )}
        </div>
      </ModalCard>
    </Modal>
  );
}
