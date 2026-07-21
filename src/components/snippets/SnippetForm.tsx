import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useAutosave } from "@/hooks/useAutosave";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import FolderSelector from "@/components/shared/FolderSelector";
import TagSelector from "@/components/shared/TagSelector";
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
import type { Snippet, SnippetFormData, SnippetStep } from "@/types";
import { getShortcutHint } from "@/stores/shortcutStore";
import { parseVariables } from "@/services/snippetParser";
import { snippetScriptText } from "@/services/snippetSteps";
import { StepListEditor } from "@/components/snippets/StepListEditor";
import { RemotePathPickerPanel } from "@/components/snippets/RemotePathPickerPanel";
import { VariableTextarea } from "@/components/snippets/VariableTextarea";

interface Props {
  initial?: Snippet;
  onSubmit: (data: SnippetFormData) => void | Promise<void>;
  onClose: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  isDirtyRef?: React.MutableRefObject<boolean>;
}

export function SnippetForm({ initial, onSubmit, onClose, onDuplicate, onDelete, isDirtyRef }: Props) {
  const { t } = useTranslation();
  const isNew = !initial;
  const pinSnippet = useSnippetStore((s) => s.pinSnippet);
  const effPinned = useEffectivePinned(initial ?? { id: "", favorite: false }, "snippet");
  const pinSource = useEffectivePinSource(initial ?? { id: "", favorite: false }, "snippet");
  const isPinned = effPinned;
  const isTeamVault = useTeamStore((s) => initial ? s.teams.some((t) => t.id === initial.vault_id) : false);
  const { folders, saveFolder } = useSnippetFolderStore();
  const defaultVaultId = useDefaultVaultId();
  const connections = useAllConnections();
  const allConnectionTags = useMemo(
    () => [...new Set(connections.flatMap((c) => c.tags))].sort(),
    [connections],
  );

  const [name, setName]         = useState(initial?.name ?? "");
  const [steps, setSteps]       = useState<SnippetStep[]>(initial?.steps ?? [{ kind: "script", content: "" }]);
  const [description, setDesc]  = useState(initial?.description ?? "");
  const [folderId, setFolderId] = useState<string | null>(initial?.folder_id ?? null);
  const [tags, setTags]         = useState<string[]>(initial?.tags ?? []);
  const [connTags, setConnTags] = useState<string[]>(initial?.only_for_connection_tags ?? []);
  const [connTagInput, setConnTagInput] = useState("");
  const [distros, setDistros]   = useState<string[]>(initial?.only_for_distros ?? []);
  const [distroInput, setDistroInput] = useState("");
  const [favorite, setFavorite] = useState(initial?.favorite ?? false);
  const [vaultId, setVaultId]   = useState(initial?.vault_id ?? defaultVaultId);
  const [remotePick, setRemotePick] = useState<{ index: number; field: "from_path" | "to_path"; isDir: boolean } | null>(null);
  const vaultTouched = useRef(false);

  // Single-script fast path: keep the plain textarea when the snippet is just one script step.
  const [forceSequence, setForceSequence] = useState(false);
  const singleStep = steps.length === 1 && steps[0].kind === "script" ? steps[0] : null;
  const showStepList = forceSequence || !singleStep;
  const content = singleStep?.content ?? "";

  const detectedVars = useMemo(() => parseVariables(snippetScriptText({ steps })), [steps]);

  useEffect(() => {
    if (isNew && !vaultTouched.current) setVaultId(defaultVaultId);
  }, [isNew, defaultVaultId]);

  const buildData = (): SnippetFormData => ({
    // "Untitled snippet" is the persisted default name when left blank; kept in English until all creation sites are localized together (see i18n issue #14)
    name: name.trim() || "Untitled snippet",
    steps,
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
    canSave: () => steps.length > 0 && steps.some((s) => s.kind !== "script" || s.content.trim()),
  });
  const markDirty = useCallback(() => {
    if (isDirtyRef) isDirtyRef.current = true;
    _markDirty();
  }, [_markDirty, isDirtyRef]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name, steps, description, folderId, tags, connTags, distros, favorite, vaultId]);

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
    ...(onDuplicate ? [{ label: t("snippets.card.duplicate"), icon: "lucide:copy", onClick: onDuplicate }] : []),
    ...(onDelete ? [{ label: t("common.action.delete"), icon: "lucide:trash-2", onClick: () => { flush(); onDelete(); }, shortcut: getShortcutHint("delete") }] : []),
  ] : [];

  return (
    <div className="relative h-full overflow-hidden">
    <PanelShell>
      <PanelHeader
        icon="lucide:braces"
        // "Untitled snippet" is the persisted default name when left blank; kept in English until all creation sites are localized together (see i18n issue #14)
        title={isNew ? t("snippets.toolbar.newSnippet") : (name.trim() || "Untitled snippet")}
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
        <FormSection label={t("snippets.form.generalSection")}>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("snippets.form.nameLabel")}</label>
            <input
              value={name}
              onChange={(e) => { markDirty(); setName(e.target.value); }}
              placeholder={t("snippets.form.namePlaceholder")}
              className={formInputClass}
              style={formInputStyle}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={formLabelClass} style={{ ...formLabelStyle, marginBottom: 0 }}>{t("snippets.form.contentLabel")}</label>
              {!showStepList && (
                <button
                  type="button"
                  onClick={() => { markDirty(); setForceSequence(true); }}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-md transition-colors hover:bg-(--t-bg-elevated)"
                  style={{ color: "var(--t-text-dim)" }}
                >
                  <Icon icon="lucide:list-plus" width={13} />
                  {t("snippets.step.addStep")}
                </button>
              )}
            </div>

            {showStepList ? (
              <StepListEditor
                value={steps}
                onChange={(next) => { markDirty(); setSteps(next); }}
                snippets={useSnippetStore.getState().snippets.filter((s) => s.id !== initial?.id)}
                onBrowseRemote={(index, field, isDir) => setRemotePick({ index, field, isDir })}
              />
            ) : (
              <VariableTextarea
                value={content}
                onChange={(v) => { markDirty(); setSteps([{ kind: "script", content: v }]); }}
                rows={6}
                // Sample shell command syntax, not prose UI copy — left untranslated like snippet body content
                placeholder="echo Hello, {{name}}!"
                style={{ minHeight: "7rem" }}
              />
            )}

            {/* Detected variables */}
            {detectedVars.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs" style={{ color: "var(--t-text-dim)" }}>{t("snippets.form.variablesLabel")}</span>
                {detectedVars.map((v) => (
                  <span
                    key={v.name}
                    className="inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded-sm"
                    style={{
                      background: v.dynamic ? "color-mix(in srgb, var(--t-accent) 15%, transparent)" : "var(--t-bg-elevated)",
                      color: v.dynamic ? "var(--t-accent)" : "var(--t-text)",
                      border: "1px solid var(--t-border)",
                    }}
                  >
                    <span>{v.name}</span>
                    <span className="font-sans" style={{ color: "var(--t-text-dim)" }}>{v.dynamic ? t("snippets.form.autoBadge") : v.type}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Syntax hint */}
            {!showStepList && (
              <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--t-text-dim)" }}>
                {t("snippets.form.syntaxHintType")} <code className="font-mono bg-(--t-bg-elevated) px-1 rounded-sm" style={{ color: "var(--t-text)" }}>{"{{"}</code> {t("snippets.form.syntaxHintForAutocomplete")}
                {" "}{t("snippets.form.syntaxHintCustomPrompts")} <code className="font-mono bg-(--t-bg-elevated) px-1 rounded-sm" style={{ color: "var(--t-text)" }}>{"{{name:type}}"}</code>
                {" "}{t("snippets.form.syntaxHintTypesList")} <code className="font-mono bg-(--t-bg-elevated) px-1 rounded-sm" style={{ color: "var(--t-text)" }}>choice:a,b</code>
              </p>
            )}
          </div>

          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("snippets.form.descriptionLabel")}</label>
            <input
              value={description}
              onChange={(e) => { markDirty(); setDesc(e.target.value); }}
              placeholder={t("snippets.form.descriptionPlaceholder")}
              className={formInputClass}
              style={formInputStyle}
            />
          </div>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("snippets.form.tagsLabel")}</label>
            <TagSelector
              value={tags}
              vaultId={vaultId}
              onChange={(next) => { markDirty(); setTags(next); }}
            />
          </div>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("snippets.form.folderLabel")}</label>
            <FolderSelector
              value={folderId}
              folders={folders}
              onChange={(id) => { markDirty(); setFolderId(id); }}
              onCreateFolder={async (name) => {
                const folder = await saveFolder({ name, object_type: "snippet", vault_id: resolveVaultIdForSave(vaultId) || undefined });
                markDirty();
                setFolderId(folder.id);
                return folder.id;
              }}
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
              {favorite ? t("snippets.form.starred") : t("snippets.form.starThisSnippet")}
            </button>
          </div>
        </FormSection>

        {/* ── Contextual filters ── */}
        <FormSection label={t("snippets.form.contextualFiltersSection")}>
          <p className="text-xs text-(--t-text-dim) -mt-1">
            {t("snippets.form.contextualFiltersHint")}
          </p>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("snippets.form.onlyForConnectionTags")}</label>
            <AutocompleteTagInput
              tags={connTags}
              input={connTagInput}
              placeholder={t("snippets.form.connectionTagsPlaceholder")}
              suggestions={allConnectionTags}
              onInputChange={setConnTagInput}
              onAdd={(v) => commitTag(connTags, v, setConnTags, setConnTagInput)}
              onRemove={(v) => removeTag(connTags, v, setConnTags)}
            />
          </div>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("snippets.form.onlyForDistros")}</label>
            <AutocompleteTagInput
              tags={distros}
              input={distroInput}
              placeholder={t("snippets.form.distrosPlaceholder")}
              suggestions={[]}
              onInputChange={setDistroInput}
              onAdd={(v) => commitTag(distros, v, setDistros, setDistroInput)}
              onRemove={(v) => removeTag(distros, v, setDistros)}
            />
          </div>
        </FormSection>
      </div>
    </PanelShell>

      <div
        className="absolute inset-0 transition-transform duration-200 ease-out border-l border-l-(--t-bg-terminal)"
        style={{ transform: remotePick ? "translateX(0)" : "translateX(100%)" }}
      >
        {remotePick && (
          <RemotePathPickerPanel
            isDir={remotePick.isDir}
            onBack={() => setRemotePick(null)}
            onPick={(p) => {
              setSteps((prev) => prev.map((s, j) =>
                j === remotePick.index && s.kind === "transfer"
                  ? { ...s, [remotePick.field]: p }
                  : s));
              markDirty();
              setRemotePick(null);
            }}
          />
        )}
      </div>
    </div>
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
  const { t } = useTranslation();
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
                aria-label={t("snippets.form.removeTagAriaLabel", { tag })}
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
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-(--t-bg-elevated) transition-colors"
            >
              <TagBadge tag={s} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
