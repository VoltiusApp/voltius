import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { folderIcon } from "@/components/folders/folderAppearance";
import { useLongPress } from "@/components/mobile/useLongPress";
import RowActionsButton from "@/components/mobile/RowActionsButton";
import { GhostOr } from "@/components/preview/GhostCard";
import { folderAccessType } from "@/components/folders/useFolderPin";
import type { Folder } from "@/types";

/** 56 dp folder row: tap opens, long-press opens the folder actions sheet. */
export default function MobileFolderRow({
  folder, count, onOpen, onActions,
}: { folder: Folder; count: number; onOpen: () => void; onActions?: () => void }) {
  const { t } = useTranslation();
  const press = useLongPress(() => onActions?.(), onOpen);
  return (
    <GhostOr type={folderAccessType(folder)} id={folder.id} icon={folderIcon(folder)} name={folder.name} layout="row">
      <div className="relative flex items-center" data-mobile-folder>
        <button
          className="flex-1 flex items-center gap-4 min-h-14 px-4 py-2 text-left min-w-0"
          aria-haspopup={onActions ? "menu" : undefined}
          {...press}
        >
          <AvatarTile icon={folderIcon(folder)} base={folder.color} className="w-10 h-10 rounded-xl text-white" iconSize={20} />
          <span className="flex-1 min-w-0 text-base font-medium text-(--t-text-primary) truncate">{folder.name}</span>
          <span className="text-sm text-(--t-text-dim) shrink-0">{count}</span>
          <Icon icon="lucide:chevron-right" width={20} className="text-(--t-text-dim) shrink-0" />
        </button>
        {onActions && (
          <RowActionsButton attr="data-mobile-folder-actions" value="" label={t("common.action.moreOptions")} name={folder.name} onTap={onActions} />
        )}
      </div>
    </GhostOr>
  );
}
