import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useAutosave } from "@/hooks/useAutosave";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { PanelActionsMenu } from "@/components/shared/PanelActionsMenu";
import { PinButton } from "@/components/shared/PinButton";
import { useSnippetStore } from "@/stores/snippetStore";
import { VaultPicker } from "@/components/shared/VaultPicker";
import {
  PanelShell,
  PanelHeader,
  FormSection,
  formInputClass,
  formInputStyle,
  formLabelClass,
  formLabelStyle,
} from "@/components/shared/Panel";
import type { Snippet, SnippetFormData } from "@/types";
import { getShortcutHint } from "@/stores/shortcutStore";

interface Props {
  initial?: Snippet;
  onSubmit: (data: SnippetFormData) => void | Promise<void>;
  onClose: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

export function SnippetForm({ initial, onSubmit, onClose, onDuplicate, onDelete }: Props) {
  const isNew = !initial;
  const pinSnippet = useSnippetStore((s) => s.pinSnippet);
  const isPinned = useSnippetStore((s) => s.snippets.find((sn) => sn.id === initial?.id)?.favorite ?? false);
  const { folders } = useSnippetFolderStore();
  const defaultVaultId = useDefaultVaultId();

  const [name, setName]         = useState(initial?.name ?? "");
  const [content, setContent]   = useState(initial?.content ?? "");
  const [description, setDesc]  = useState(initial?.description ?? "");
  const [folderId, setFolderId] = useState<string | null>(initial?.folder_id ?? null);
  const [tags, setTags]         = useState<string[]>(initial?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [connTags, setConnTags] = useState<string[]>(initial?.only_for_connection_tags ?? []);
  const [connTagInput, setConnTagInput] = useState("");
  const [distros, setDistros]   = useState<string[]>(initial?.only_for_distros ?? []);
  const [distroInput, setDistroInput] = useState("");
  const [favorite, setFavorite] = useState(initial?.favorite ?? false);
  const [vaultId, setVaultId]   = useState(initial?.vault_id ?? defaultVaultId);
  const vaultTouched = useRef(false);

  useEffect(() => {
    if (isNew && !vaultTouched.current) setVaultId(defaultVaultId);
  }, [isNew, defaultVaultId]);

  const buildData = (): SnippetFormData => ({
    name: name.trim() || "Untitled snippet",
    content,
    description: description.trim() || undefined,
    tags,
    folder_id: folderId ?? undefined,
    favorite,
    only_for_connection_tags: connTags,
    only_for_distros: distros,
    vault_id: resolveVaultIdForSave(vaultId),
  });

  const { schedule, markDirty, flushAndClose, flush, saveState } = useAutosave({
    onSave: () => onSubmit(buildData()) ?? undefined,
    canSave: () => !!content.trim(),
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name, content, description, folderId, tags, connTags, distros, favorite, vaultId]);

  const handleClose = () => flushAndClose(onClose);

  // ── Tag helpers — all call markDirty ──────────────────────────────────────

  function commitTag(
    list: string[],
    value: string,
    setList: (v: string[]) => void,
    setInput: (v: string) => void,
  ) {
    const trimmed = value.trim();
    if (trimmed && !list.includes(trimmed)) { markDirty(); setList([...list, trimmed]); }
    setInput("");
  }

  function removeTag(list: string[], value: string, setList: (v: string[]) => void) {
    markDirty();
    setList(list.filter((t) => t !== value));
  }

  const panelItems = initial ? [
    ...(onDuplicate ? [{ label: "Duplicate", icon: "lucide:copy", onClick: onDuplicate }] : []),
    ...(onDelete ? [{ label: "Delete", icon: "lucide:trash-2", onClick: () => { flush(); onDelete(); }, shortcut: getShortcutHint("delete") }] : []),
  ] : [];

  return (
    <PanelShell>
      <PanelHeader
        icon="lucide:braces"
        title={isNew ? "New Snippet" : (name.trim() || "Untitled snippet")}
        subtitle={<VaultPicker vaultId={vaultId} onChange={(id) => { vaultTouched.current = true; setVaultId(id); markDirty(); }} />}
        onClose={handleClose}
        saveState={saveState}
        actions={
          <>
            {!isNew && <PinButton pinned={isPinned} onToggle={() => pinSnippet(initial!.id, !isPinned).catch(() => {})} />}
            {panelItems.length > 0 && <PanelActionsMenu items={panelItems} />}
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ── Basics ── */}
        <FormSection label="Basics">
          <div>
            <label className={formLabelClass} style={formLabelStyle}>Name</label>
            <input
              value={name}
              onChange={(e) => { markDirty(); setName(e.target.value); }}
              placeholder="My snippet"
              className={formInputClass}
              style={formInputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
            />
          </div>

          <div>
            <label className={formLabelClass} style={formLabelStyle}>Content</label>
            <textarea
              value={content}
              onChange={(e) => { markDirty(); setContent(e.target.value); }}
              placeholder="echo Hello, {{name}}!"
              rows={6}
              className={`${formInputClass} font-mono resize-y`}
              style={{ ...formInputStyle, minHeight: "7rem" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
            />
            <p className="mt-1 text-xs text-[var(--t-text-dim)]">
              Use{" "}
              <code className="font-mono bg-[var(--t-bg-elevated)] px-1 rounded">
                {"{{variable}}"}
              </code>{" "}
              for dynamic values.
            </p>
          </div>

          <div>
            <label className={formLabelClass} style={formLabelStyle}>Description (optional)</label>
            <input
              value={description}
              onChange={(e) => { markDirty(); setDesc(e.target.value); }}
              placeholder="What does this snippet do?"
              className={formInputClass}
              style={formInputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
            />
          </div>
        </FormSection>

        {/* ── Organization ── */}
        <FormSection label="Organization">
          <div>
            <label className={formLabelClass} style={formLabelStyle}>Folder</label>
            <select
              value={folderId ?? ""}
              onChange={(e) => { markDirty(); setFolderId(e.target.value || null); }}
              className={formInputClass}
              style={formInputStyle}
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={formLabelClass} style={formLabelStyle}>Tags</label>
            <TagInput
              tags={tags}
              input={tagInput}
              placeholder="Add tag..."
              onInputChange={setTagInput}
              onAdd={(v) => commitTag(tags, v, setTags, setTagInput)}
              onRemove={(v) => removeTag(tags, v, setTags)}
            />
          </div>

          <div>
            <button
              type="button"
              onClick={() => { markDirty(); setFavorite((f) => !f); }}
              className="flex items-center gap-2 text-sm transition-colors"
              style={{ color: favorite ? "var(--t-accent)" : "var(--t-text-dim)" }}
            >
              <Icon icon="lucide:star" width={15} />
              {favorite ? "Starred" : "Star this snippet"}
            </button>
          </div>
        </FormSection>

        {/* ── Contextual filters ── */}
        <FormSection label="Contextual Filters">
          <p className="text-xs text-[var(--t-text-dim)] -mt-1">
            Leave empty to show for all connections. Non-matching snippets are greyed out, not hidden.
          </p>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>Only for connection tags</label>
            <TagInput
              tags={connTags}
              input={connTagInput}
              placeholder="e.g. production"
              onInputChange={setConnTagInput}
              onAdd={(v) => commitTag(connTags, v, setConnTags, setConnTagInput)}
              onRemove={(v) => removeTag(connTags, v, setConnTags)}
            />
          </div>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>Only for distros</label>
            <TagInput
              tags={distros}
              input={distroInput}
              placeholder="e.g. ubuntu, debian"
              onInputChange={setDistroInput}
              onAdd={(v) => commitTag(distros, v, setDistros, setDistroInput)}
              onRemove={(v) => removeTag(distros, v, setDistros)}
            />
          </div>
        </FormSection>
      </div>
    </PanelShell>
  );
}

// ─── Tag input ────────────────────────────────────────────────────────────────

function TagInput({
  tags,
  input,
  placeholder,
  onInputChange,
  onAdd,
  onRemove,
}: {
  tags: string[];
  input: string;
  placeholder: string;
  onInputChange: (v: string) => void;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-1.5 p-2 rounded-lg min-h-[2.5rem] cursor-text"
      style={{ background: "var(--t-bg-base)", border: "1px solid var(--t-border)" }}
      onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-[var(--t-bg-elevated)] text-[var(--t-text-secondary)] border border-[var(--t-border-hover)]"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(tag); }}
            className="text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] transition-colors"
          >
            <Icon icon="lucide:x" width={10} />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[80px] bg-transparent text-xs outline-none"
        style={{ color: "var(--t-text-primary)" }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); onAdd(input); }
          if (e.key === "Backspace" && !input && tags.length > 0) onRemove(tags[tags.length - 1]);
        }}
        onBlur={() => { if (input.trim()) onAdd(input); }}
      />
    </div>
  );
}
