import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useAutosave } from "@/hooks/useAutosave";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { PanelActionsMenu } from "@/components/shared/PanelActionsMenu";
import { PinButton } from "@/components/shared/PinButton";
import { useSnippetStore } from "@/stores/snippetStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { VaultPicker } from "@/components/shared/VaultPicker";
import { TagBadge } from "@/components/shared/TagBadge";
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
  isDirtyRef?: React.MutableRefObject<boolean>;
}

export function SnippetForm({ initial, onSubmit, onClose, onDuplicate, onDelete, isDirtyRef }: Props) {
  const isNew = !initial;
  const pinSnippet = useSnippetStore((s) => s.pinSnippet);
  const isPinned = useSnippetStore((s) => s.snippets.find((sn) => sn.id === initial?.id)?.favorite ?? false);
  const { folders } = useSnippetFolderStore();
  const defaultVaultId = useDefaultVaultId();
  const connections = useConnectionStore((s) => s.connections);
  const allConnectionTags = useMemo(
    () => [...new Set(connections.flatMap((c) => c.tags))].sort(),
    [connections],
  );

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

  const { schedule, markDirty: _markDirty, flushAndClose, flush, saveState } = useAutosave({
    onSave: () => onSubmit(buildData()) ?? undefined,
    canSave: () => !!content.trim(),
  });
  const markDirty = useCallback(() => {
    if (isDirtyRef) isDirtyRef.current = true;
    _markDirty();
  }, [_markDirty, isDirtyRef]);

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
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((tag) => (
                  <TagBadge key={tag} tag={tag} className="flex items-center gap-1 px-2 rounded-md font-medium">
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tags, tag, setTags)}
                      className="transition-opacity opacity-60 hover:opacity-100"
                      aria-label={`Remove tag ${tag}`}
                    >
                      <Icon icon="lucide:x" width={10} />
                    </button>
                  </TagBadge>
                ))}
              </div>
            )}
            <input
              className={formInputClass}
              style={formInputStyle}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                  e.preventDefault();
                  commitTag(tags, tagInput.trim().replace(/,$/, ""), setTags, setTagInput);
                } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
                  removeTag(tags, tags[tags.length - 1], setTags);
                }
              }}
              onBlur={() => { if (tagInput.trim()) commitTag(tags, tagInput, setTags, setTagInput); }}
              placeholder="Add tag, press Enter"
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
            <AutocompleteTagInput
              tags={connTags}
              input={connTagInput}
              placeholder="e.g. production"
              suggestions={allConnectionTags}
              onInputChange={setConnTagInput}
              onAdd={(v) => commitTag(connTags, v, setConnTags, setConnTagInput)}
              onRemove={(v) => removeTag(connTags, v, setConnTags)}
            />
          </div>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>Only for distros</label>
            <AutocompleteTagInput
              tags={distros}
              input={distroInput}
              placeholder="e.g. ubuntu, debian"
              suggestions={[]}
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

// ─── Autocomplete tag input ───────────────────────────────────────────────────

function AutocompleteTagInput({
  tags,
  input,
  placeholder,
  suggestions,
  onInputChange,
  onAdd,
  onRemove,
}: {
  tags: string[];
  input: string;
  placeholder: string;
  suggestions: string[];
  onInputChange: (v: string) => void;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = suggestions.filter(
    (s) => !tags.includes(s) && s.toLowerCase().includes(input.toLowerCase()),
  );
  const showDropdown = open && filtered.length > 0;

  return (
    <div ref={containerRef} className="relative">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map((tag) => (
            <TagBadge key={tag} tag={tag} className="flex items-center gap-1 px-2 rounded-md font-medium">
              {tag}
              <button
                type="button"
                onClick={() => onRemove(tag)}
                className="transition-opacity opacity-60 hover:opacity-100"
                aria-label={`Remove tag ${tag}`}
              >
                <Icon icon="lucide:x" width={10} />
              </button>
            </TagBadge>
          ))}
        </div>
      )}
      <input
        className={formInputClass}
        style={formInputStyle}
        value={input}
        onChange={(e) => { onInputChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
          if (input.trim()) onAdd(input);
        }}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && input.trim()) {
            e.preventDefault();
            onAdd(input.trim().replace(/,$/, ""));
            setOpen(false);
          } else if (e.key === "Backspace" && !input && tags.length > 0) {
            onRemove(tags[tags.length - 1]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showDropdown && (
        <div
          className="absolute z-50 w-full mt-1 rounded-lg shadow-lg overflow-hidden"
          style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
        >
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onAdd(s); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-[var(--t-bg-elevated)] transition-colors"
            >
              <TagBadge tag={s} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
