import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <BottomSheet title={t("mobile.sheets.shared.moveToFolder")} onClose={onClose} registerBack={false}>
      {targets.map((target) => {
        const selected = (target.id ?? null) === (currentFolderId ?? null);
        return (
          <button
            key={target.id ?? "__root__"}
            data-move-target={target.id ?? "root"}
            className="w-full flex items-center gap-2 px-3 py-3 rounded-xl text-left active:bg-(--t-bg-card)"
            style={{ paddingLeft: `${12 + target.depth * 16}px` }}
            onClick={() => { onPick(target.id); onClose(); }}
          >
            <Icon icon={target.id === null ? "lucide:folder-x" : "lucide:folder"} width={18} className="shrink-0 text-(--t-text-dim)" />
            <span className="flex-1 min-w-0 text-sm font-medium text-(--t-text-primary) truncate">{target.id === null ? t("shared.folderSelector.noFolder") : target.name}</span>
            {selected && <Icon icon="lucide:check" width={16} className="shrink-0 text-(--t-accent)" />}
          </button>
        );
      })}
    </BottomSheet>
  );
}
