import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import FolderFormSheet from "./FolderFormSheet";
import type { Folder } from "@/types";

type Mode = "menu" | "rename" | "confirm-delete";

export default function FolderActionsSheet({
  folder, onRename, onDelete, onClose,
}: {
  folder: Folder;
  onRename: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("menu");

  if (mode === "rename") {
    return (
      <FolderFormSheet
        title={t("mobile.sheets.folderActions.renameTitle")}
        initialName={folder.name}
        onSubmit={(name) => onRename(name)}
        onClose={onClose}
      />
    );
  }

  const Row = ({ icon, label, danger, onTap, slug }: { icon: string; label: string; danger?: boolean; onTap: () => void; slug: string }) => (
    <button
      data-folder-action={slug}
      className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left active:bg-(--t-bg-card)"
      style={{ color: danger ? "var(--t-danger, #e5484d)" : "var(--t-text-primary)" }}
      onClick={onTap}
    >
      <Icon icon={icon} width={18} />
      <span className="text-sm font-medium">{label}</span>
    </button>
  );

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
      <Row slug="rename" icon="lucide:pencil" label={t("common.action.rename")} onTap={() => setMode("rename")} />
      <Row slug="delete" icon="lucide:trash-2" label={t("common.action.delete")} danger onTap={() => setMode("confirm-delete")} />
    </BottomSheet>
  );
}
