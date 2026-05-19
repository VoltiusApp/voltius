import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useAutosave } from "@/hooks/useAutosave";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { PanelActionsMenu } from "@/components/shared/PanelActionsMenu";
import { PinButton } from "@/components/shared/PinButton";
import { useSnippetStore } from "@/stores/snippetStore";
import { useTeamStore } from "@/stores/teamStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";
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
import { parseVariables } from "@/services/snippetParser";

const DYNAMIC_VAR_DEFS: { value: string; desc: string }[] = [
  { value: "connection.host",     desc: "Active SSH hostname / IP" },
  { value: "connection.username", desc: "Active SSH username" },
  { value: "connection.name",     desc: "Active connection name" },
  { value: "date",                desc: "Today — YYYY-MM-DD" },
  { value: "datetime",            desc: "Date + time — YYYY-MM-DD HH:MM:SS" },
  { value: "timestamp",           desc: "Unix timestamp" },
  { value: "clipboard",           desc: "Current clipboard contents" },
];

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
  const effPinned = useEffectivePinned(initial ?? { id: "", favorite: false }, "snippet");
  const pinSource = useEffectivePinSource(initial ?? { id: "", favorite: false }, "snippet");
  const isPinned = effPinned;
  const isTeamVault = useTeamStore((s) => initial ? s.teams.some((t) => t.id === initial.vault_id) : false);
  const { folders } = useSnippetFolderStore();
  const defaultVaultId = useDefaultVaultId();
  const connections = useAllConnections();
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

  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [varQuery, setVarQuery] = useState<string | null>(null);
  const [varSuggestIdx, setVarSuggestIdx] = useState(0);
  const detectedVars = useMemo(() => parseVariables(content), [content]);

  function syncVarQuery(el: HTMLTextAreaElement) {
    const before = el.value.slice(0, el.selectionStart);
    const match = before.match(/\{\{([^}]*)$/);
    const q = match ? match[1] : null;
    setVarQuery(q);
    if (q !== null) setVarSuggestIdx(0);
  }

  function insertVar(varName: string) {
    const el = contentRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const before = el.value.slice(0, cursor);
    const after = el.value.slice(el.selectionEnd);
    const match = before.match(/\{\{([^}]*)$/);
    let newVal: string;
    let newCursor: number;
    if (match) {
      const start = cursor - match[1].length;
      newVal = before.slice(0, start) + varName + "}}" + after;
      newCursor = start + varName.length + 2;
    } else {
      newVal = before + "{{" + varName + "}}" + after;
      newCursor = cursor + varName.length + 4;
    }
    markDirty();
    setContent(newVal);
    setVarQuery(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(newCursor, newCursor); });
  }

  const varSuggestions = varQuery !== null
    ? DYNAMIC_VAR_DEFS.filter((s) => s.value.startsWith(varQuery.toLowerCase()))
    : [];

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
            {!isNew && <PinButton pinned={isPinned} onToggle={() => {
              if (!isTeamVault) {
                pinSnippet(initial!.id, !isPinned).catch(() => {});
              } else {
                pinSnippet(initial!.id, nextPersonalPinValue(pinSource)).catch(() => {});
              }
            }} />}
            {panelItems.length > 0 && <PanelActionsMenu items={panelItems} />}
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ── General ── */}
        <FormSection label="General">
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
            <div className="relative">
              <textarea
                ref={contentRef}
                value={content}
                onChange={(e) => { markDirty(); setContent(e.target.value); syncVarQuery(e.target); }}
                onSelect={(e) => syncVarQuery(e.currentTarget)}
                onKeyDown={(e) => {
                  if (varSuggestions.length === 0) return;
                  if (e.key === "ArrowDown") { e.preventDefault(); setVarSuggestIdx((i) => Math.min(i + 1, varSuggestions.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setVarSuggestIdx((i) => Math.max(i - 1, 0)); }
                  else if ((e.key === "Enter" || e.key === "Tab") && varQuery !== null) { e.preventDefault(); insertVar(varSuggestions[varSuggestIdx]?.value ?? ""); }
                  else if (e.key === "Escape") { setVarQuery(null); }
                }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "var(--t-border)"; setTimeout(() => setVarQuery(null), 100); }}
                placeholder="echo Hello, {{name}}!"
                rows={6}
                className={`${formInputClass} font-mono resize-y`}
                style={{ ...formInputStyle, minHeight: "7rem" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
              />

              {/* Autocomplete dropdown */}
              {varSuggestions.length > 0 && (
                <div
                  className="absolute top-full left-0 z-50 w-full mt-1 rounded-lg shadow-lg overflow-hidden"
                  style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
                >
                  {varSuggestions.map((s, i) => (
                    <button
                      key={s.value}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); insertVar(s.value); }}
                      className={`flex items-center justify-between w-full px-3 py-1.5 text-xs text-left transition-colors ${
                        i === varSuggestIdx ? "bg-[var(--t-bg-elevated)]" : "hover:bg-[var(--t-bg-elevated)]"
                      }`}
                    >
                      <code className="font-mono" style={{ color: "var(--t-accent)" }}>{`{{${s.value}}}`}</code>
                      <span style={{ color: "var(--t-text-dim)" }}>{s.desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Detected variables */}
            {detectedVars.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs" style={{ color: "var(--t-text-dim)" }}>Variables:</span>
                {detectedVars.map((v) => (
                  <span
                    key={v.name}
                    className="inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded"
                    style={{
                      background: v.dynamic ? "color-mix(in srgb, var(--t-accent) 15%, transparent)" : "var(--t-bg-elevated)",
                      color: v.dynamic ? "var(--t-accent)" : "var(--t-text)",
                      border: "1px solid var(--t-border)",
                    }}
                  >
                    <span>{v.name}</span>
                    <span className="font-sans" style={{ color: "var(--t-text-dim)" }}>{v.dynamic ? "auto" : v.type}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Syntax hint */}
            <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--t-text-dim)" }}>
              Type <code className="font-mono bg-[var(--t-bg-elevated)] px-1 rounded" style={{ color: "var(--t-text)" }}>{"{{"}</code> for autocomplete.
              {" "}Custom prompts: <code className="font-mono bg-[var(--t-bg-elevated)] px-1 rounded" style={{ color: "var(--t-text)" }}>{"{{name:type}}"}</code>
              {" "}— text · number · password · boolean · <code className="font-mono bg-[var(--t-bg-elevated)] px-1 rounded" style={{ color: "var(--t-text)" }}>choice:a,b</code>
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
