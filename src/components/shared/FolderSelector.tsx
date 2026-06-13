import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { Folder } from "@/types";
import { PickerSurface } from "./PickerSurface";

interface Props {
  value: string | null;
  folders: Folder[];
  onChange: (id: string | null) => void;
  onCreateFolder: (name: string) => Promise<string>;
}

export default function FolderSelector({ value, folders, onChange, onCreateFolder }: Props) {
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
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
        style={{
          background: "var(--t-bg-base)",
          border: "1px solid var(--t-border)",
          color: selected ? "var(--t-text-primary)" : "var(--t-text-dim)",
        }}
      >
        <Icon
          icon={selected ? "lucide:folder-open" : "lucide:folder"}
          width={14}
          className="text-(--t-text-dim) shrink-0"
        />
        <span className="flex-1 text-left truncate text-xs">{selected ? selected.name : "No folder"}</span>
        <span className="[&_path]:stroke-[2.5]">
          <Icon
            icon="lucide:chevron-down"
            width={14}
            className="text-(--t-text-dim) shrink-0"
            style={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </span>
      </button>

      <PickerSurface open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} title="Folder">
        <button
          type="button"
          onClick={() => { onChange(null); setOpen(false); }}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors"
          style={{ color: value === null ? "var(--t-accent)" : "var(--t-text-secondary)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
        >
          <Icon icon="lucide:folder-x" width={13} className="shrink-0" />
          <span className="flex-1 text-left text-(--t-text-primary)">No folder</span>
          {value === null && (
            <span className="[&_path]:stroke-[2.5]">
              <Icon icon="lucide:check" width={13} />
            </span>
          )}
        </button>

        {folders.length > 0 && <div className="my-1 border-t border-t-(--t-bg-card-hover)" />}

        {folders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => { onChange(folder.id); setOpen(false); }}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors"
            style={{ color: value === folder.id ? "var(--t-accent)" : "var(--t-text-secondary)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
          >
            <Icon icon="lucide:folder" width={13} className="shrink-0" />
            <span className="flex-1 text-left text-(--t-text-primary) truncate">{folder.name}</span>
            {value === folder.id && (
              <span className="[&_path]:stroke-[2.5]">
                <Icon icon="lucide:check" width={13} className="text-(--t-accent)" />
              </span>
            )}
          </button>
        ))}

        <div className="mt-1 border-t border-t-(--t-bg-card-hover)" />

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
              placeholder="Folder name"
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
              <Icon icon={saving ? "lucide:loader-2" : "lucide:check"} width={13} className={saving ? "animate-spin" : undefined} />
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
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors text-(--t-text-dim)"
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--t-accent)";
              (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            <Icon icon="lucide:folder-plus" width={13} />
            <span className="flex-1 text-left">New folder</span>
          </button>
        )}
      </PickerSurface>
    </div>
  );
}
