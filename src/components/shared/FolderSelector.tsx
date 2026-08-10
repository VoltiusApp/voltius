import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { Folder } from "@/types";
import { PickerSurface } from "./PickerSurface";
import { PickerDivider, PickerFooterAction, PickerOption, PickerTrigger } from "./pickerParts";

interface Props {
  value: string | null;
  folders: Folder[];
  onChange: (id: string | null) => void;
  onCreateFolder: (name: string) => Promise<string>;
}

export default function FolderSelector({ value, folders, onChange, onCreateFolder }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setCreating(false); setNewName(""); }
  }, [open]);

  useEffect(() => {
    if (creating) setTimeout(() => newNameRef.current?.focus(), 0);
  }, [creating]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const id = await onCreateFolder(name);
      onChange(id);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const selected = folders.find((f) => f.id === value) ?? null;

  return (
    <div>
      <PickerTrigger
        buttonRef={buttonRef}
        icon={selected ? "lucide:folder-open" : "lucide:folder"}
        label={selected ? selected.name : t("shared.folderSelector.noFolder")}
        filled={!!selected}
        open={open}
        onToggle={() => setOpen((o) => !o)}
      />

      <PickerSurface open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} title={t("common.entity.folder")}>
        <PickerOption
          icon="lucide:folder-x"
          label={t("shared.folderSelector.noFolder")}
          labelTone="primary"
          active={value === null}
          onClick={() => { onChange(null); setOpen(false); }}
        />

        {folders.length > 0 && <PickerDivider />}

        {folders.map((folder) => (
          <PickerOption
            key={folder.id}
            icon="lucide:folder"
            label={folder.name}
            labelTone="primary"
            active={value === folder.id}
            onClick={() => { onChange(folder.id); setOpen(false); }}
          />
        ))}

        <PickerDivider edge />

        {creating ? (
          <div className="flex items-center gap-1.5 px-2 py-1.5">
            <Icon icon="lucide:folder-plus" width={13} className="text-(--t-text-dim) shrink-0" />
            <input
              ref={newNameRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void handleCreate(); }
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder={t("shared.folderSelector.namePlaceholder")}
              className="flex-1 bg-transparent outline-hidden text-xs text-(--t-text-primary) placeholder:text-(--t-text-dim) min-w-0"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!newName.trim() || saving}
              className="shrink-0 p-1 rounded-sm transition-colors disabled:opacity-40"
              style={{ color: "var(--t-accent)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <Icon icon={saving ? "lucide:loader-circle" : "lucide:check"} width={13} className={saving ? "animate-spin" : undefined} />
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="shrink-0 p-1 rounded-sm transition-colors text-(--t-text-dim)"
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <Icon icon="lucide:x" width={13} />
            </button>
          </div>
        ) : (
          <PickerFooterAction
            icon="lucide:folder-plus"
            label={t("shared.folderSelector.newFolder")}
            onClick={() => setCreating(true)}
          />
        )}
      </PickerSurface>
    </div>
  );
}
