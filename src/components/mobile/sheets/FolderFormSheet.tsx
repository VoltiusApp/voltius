import { useState } from "react";
import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";

export default function FolderFormSheet({
  title, initialName = "", submitLabel, onSubmit, onClose,
}: {
  title: string;
  initialName?: string;
  submitLabel?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  return (
    <BottomSheet title={title} onClose={onClose} registerBack={false}>
      <div className="px-3 pt-1 pb-3 flex flex-col gap-3">
        <input
          data-folder-name-input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("mobile.sftp.folderNamePlaceholder")}
          className="w-full h-11 px-3 rounded-xl bg-(--t-bg-card) outline-none text-sm text-(--t-text-primary)"
          style={{ border: "1px solid var(--t-border)" }}
        />
        <button
          data-folder-name-save
          disabled={!trimmed}
          onClick={() => { onSubmit(trimmed); onClose(); }}
          className="h-11 rounded-xl text-sm font-medium disabled:opacity-40"
          style={{ background: "var(--t-accent)", color: "var(--t-on-accent, #fff)" }}
        >
          {submitLabel ?? t("common.action.save")}
        </button>
      </div>
    </BottomSheet>
  );
}
