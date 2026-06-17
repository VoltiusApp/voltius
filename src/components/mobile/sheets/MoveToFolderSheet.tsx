import { Icon } from "@iconify/react";
import BottomSheet from "./BottomSheet";
import type { MoveTarget } from "@/components/mobile/folders/mobileFolderCore";

export default function MoveToFolderSheet({
  targets, currentFolderId, onPick, onClose,
}: {
  targets: MoveTarget[];
  currentFolderId: string | null;
  onPick: (folderId: string | null) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet title="Move to folder" onClose={onClose} registerBack={false}>
      {targets.map((t) => {
        const selected = (t.id ?? null) === (currentFolderId ?? null);
        return (
          <button
            key={t.id ?? "__root__"}
            data-move-target={t.id ?? "root"}
            className="w-full flex items-center gap-2 px-3 py-3 rounded-xl text-left active:bg-(--t-bg-card)"
            style={{ paddingLeft: `${12 + t.depth * 16}px` }}
            onClick={() => { onPick(t.id); onClose(); }}
          >
            <Icon icon={t.id === null ? "lucide:folder-x" : "lucide:folder"} width={18} className="shrink-0 text-(--t-text-dim)" />
            <span className="flex-1 min-w-0 text-sm font-medium text-(--t-text-primary) truncate">{t.name}</span>
            {selected && <Icon icon="lucide:check" width={16} className="shrink-0 text-(--t-accent)" />}
          </button>
        );
      })}
    </BottomSheet>
  );
}
