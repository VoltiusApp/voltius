import { Icon } from "@iconify/react";
import { AvatarTile } from "@/components/shared/AvatarTile";

export default function MobileFolderRow({
  name, count, onOpen, onActions,
}: { name: string; count: number; onOpen: () => void; onActions: () => void }) {
  return (
    <div className="flex items-center" data-mobile-folder>
      <button
        className="flex-1 flex items-center gap-3 px-4 py-2.5 text-left active:bg-(--t-bg-card) min-w-0"
        onClick={onOpen}
      >
        <AvatarTile icon="lucide:folder" className="w-9 h-9 rounded-lg" iconSize={18} />
        <span className="flex-1 min-w-0 text-sm font-medium text-(--t-text-primary) truncate">{name}</span>
        <span className="text-xs text-(--t-text-dim) shrink-0">{count}</span>
        <Icon icon="lucide:chevron-right" width={18} className="text-(--t-text-dim) shrink-0" />
      </button>
      <button data-mobile-folder-actions className="p-3 text-(--t-text-dim)" onClick={onActions}>
        <Icon icon="lucide:ellipsis-vertical" width={18} />
      </button>
    </div>
  );
}
