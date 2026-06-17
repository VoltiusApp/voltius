import { useState } from "react";
import { Icon } from "@iconify/react";
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
  const [mode, setMode] = useState<Mode>("menu");

  if (mode === "rename") {
    return (
      <FolderFormSheet
        title="Rename folder"
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
      <BottomSheet title="Delete folder?" onClose={onClose} registerBack={false}>
        <div className="px-3 pt-1 pb-2 text-sm text-(--t-text-dim)">
          Delete <span className="text-(--t-text-primary) font-medium">{folder.name}</span> and everything inside it? This can&rsquo;t be undone.
        </div>
        <Row slug="delete-confirm" icon="lucide:trash-2" label="Delete" danger onTap={() => { onDelete(); onClose(); }} />
        <Row slug="cancel" icon="lucide:x" label="Cancel" onTap={() => setMode("menu")} />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet title={folder.name} onClose={onClose} registerBack={false}>
      <Row slug="rename" icon="lucide:pencil" label="Rename" onTap={() => setMode("rename")} />
      <Row slug="delete" icon="lucide:trash-2" label="Delete" danger onTap={() => setMode("confirm-delete")} />
    </BottomSheet>
  );
}
