import { useState } from "react";
import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import FolderFormSheet, { type FolderEdit } from "./FolderFormSheet";
import type { Folder } from "@/types";
import { SheetActionRow, type SheetAction } from "./SheetActionRow";

type Mode = "menu" | "edit" | "confirm-delete";

const Row = (it: SheetAction) => <SheetActionRow attr="folder-action" it={it} />;

export default function FolderActionsSheet({
  folder, onSave, onDelete, onClose,
}: {
  folder: Folder;
  onSave: (edit: FolderEdit) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("menu");

  if (mode === "edit") {
    return (
      <FolderFormSheet
        title={t("folders.editPanel.title")}
        initialName={folder.name}
        initialAppearance={{ color: folder.color, icon: folder.icon }}
        onSubmit={onSave}
        onClose={onClose}
      />
    );
  }

  if (mode === "confirm-delete") {
    return (
      <BottomSheet title={t("mobile.sheets.folderActions.deleteTitle")} onClose={onClose} registerBack={false}>
        <div className="px-3 pt-1 pb-2 text-sm text-(--t-text-dim)">
          {t("mobile.sheets.folderActions.deleteBody", { name: folder.name })}
        </div>
        <Row slug="delete-confirm" icon="lucide:trash-2" label={t("common.action.delete")} danger onTap={() => { onDelete(); onClose(); }} />
        <Row slug="cancel" icon="lucide:x" label={t("common.action.cancel")} onTap={() => setMode("menu")} />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet title={folder.name} onClose={onClose} registerBack={false}>
      <Row slug="rename" icon="lucide:pencil" label={t("common.action.edit")} onTap={() => setMode("edit")} />
      <Row slug="delete" icon="lucide:trash-2" label={t("common.action.delete")} danger onTap={() => setMode("confirm-delete")} />
    </BottomSheet>
  );
}
