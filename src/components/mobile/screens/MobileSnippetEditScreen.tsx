import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import MobileEditScreen from "../MobileEditScreen";
import { useSnippetStore } from "@/stores/snippetStore";
import { useAllSnippets } from "@/hooks/useAllSnippets";
import { useVaultScope } from "@/hooks/useVaultScope";
import { useBackInterceptor } from "@/hooks/useBackInterceptor";
import { snippetToForm } from "@/utils/snippetForm";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useCloseWhenGone } from "@/hooks/useCloseWhenGone";
import { haptic } from "@/lib/haptics";
import { StepListEditor } from "@/components/snippets/StepListEditor";
import { ScriptEditor } from "@/components/snippets/ScriptEditor";
import { RemotePathPickerPanel } from "@/components/snippets/RemotePathPickerPanel";
import { ReadOnlyFields, withEditAccess, type EditAccessProps } from "@/components/shared/editAccess";
import { FieldError, useRequiredField } from "@/components/shared/fieldValidation";
import { formInputClass, formInputStyle, formLabelClass, formLabelStyle } from "@/components/shared/Panel";
import type { Snippet, SnippetFormData, SnippetStep } from "@/types";

export default function MobileSnippetEditScreen({ snippetId }: { snippetId?: string }) {
  const pop = useMobileNavStore((s) => s.pop);
  const snippets = useAllSnippets();
  const editing = snippetId ? snippets.find((s) => s.id === snippetId) ?? null : null;
  useCloseWhenGone(snippetId, editing !== null, pop);
  return <MobileSnippetEditor editing={editing} />;
}

interface EditorProps {
  editing: Snippet | null;
}

const MobileSnippetEditor = withEditAccess("snippet", (p: EditorProps) => p.editing ?? undefined, MobileSnippetEditorFields);

const NEW_STEPS: SnippetStep[] = [{ kind: "script", content: "" }];

/**
 * The one mobile editor that saves explicitly: a snippet is only written once it has a
 * name and a non-empty step, and the step list passes through states that must not be
 * synced half-typed. So it keeps a single Save action, and Back over unsaved changes
 * asks first (Save / Keep editing / Discard).
 */
function MobileSnippetEditorFields({ editing, readOnly }: EditorProps & EditAccessProps) {
  const { t } = useTranslation();
  const pop = useMobileNavStore((s) => s.pop);
  const snippets = useAllSnippets();
  const createSnippet = useSnippetStore((s) => s.createSnippet);
  const updateSnippet = useSnippetStore((s) => s.updateSnippet);
  const deleteSnippet = useSnippetStore((s) => s.deleteSnippet);
  const { createVaultId } = useVaultScope();

  const initialSteps = editing?.steps ?? NEW_STEPS;
  const [name, setName] = useState(editing?.name ?? "");
  const [steps, setSteps] = useState<SnippetStep[]>(initialSteps);
  const [remotePick, setRemotePick] = useState<{ index: number; field: "from_path" | "to_path"; isDir: boolean } | null>(null);
  const [revealErrors, setRevealErrors] = useState(false);
  useBackInterceptor(!!remotePick, () => setRemotePick(null));

  // Single-script fast path: keep the plain textarea when the snippet is just one script step.
  const [forceSequence, setForceSequence] = useState(false);
  const singleStep = steps.length === 1 && steps[0].kind === "script" ? steps[0] : null;
  const showStepList = forceSequence || !singleStep;
  const content = singleStep?.content ?? "";

  const hasContent = steps.some((s) => s.kind !== "script" || s.content.trim());
  const canSave = !readOnly && name.trim().length > 0 && hasContent;
  const dirty = !readOnly && (name !== (editing?.name ?? "") || JSON.stringify(steps) !== JSON.stringify(initialSteps));
  const nameField = useRequiredField(name, { enabled: true, reveal: revealErrors });
  const contentField = useRequiredField(hasContent ? "x" : "", { enabled: !showStepList, reveal: revealErrors });

  const save = async () => {
    if (!canSave) {
      setRevealErrors(true);
      haptic("reject");
      return;
    }
    if (editing) {
      await updateSnippet(editing.id, { ...snippetToForm(editing), name: name.trim(), steps });
    } else {
      const data: SnippetFormData = {
        name: name.trim(), steps,
        tags: [], favorite: false,
        only_for_connection_tags: [], only_for_distros: [],
        vault_id: createVaultId,
      };
      await createSnippet(data);
    }
    pop();
  };

  return (
    <MobileEditScreen
      form="snippet"
      title={editing ? t("mobile.snippetEdit.editTitle") : t("mobile.snippetEdit.newTitle")}
      onLeave={pop}
      primary={{ label: t("common.action.save"), attr: "mobile-snippet-save", disabled: readOnly, onClick: () => void save() }}
      guard={dirty ? {
        title: t("mobile.editForm.unsavedTitle"),
        body: t("mobile.editForm.unsavedBody"),
        onSave: canSave ? () => void save() : undefined,
      } : null}
      onRevealErrors={() => setRevealErrors(true)}
      overlay={remotePick && (
        <div className="absolute inset-0 z-40 bg-(--t-bg-base)">
          <RemotePathPickerPanel
            isDir={remotePick.isDir}
            onBack={() => setRemotePick(null)}
            onPick={(p) => {
              setSteps((prev) => prev.map((s, j) =>
                j === remotePick.index && s.kind === "transfer"
                  ? { ...s, [remotePick.field]: p }
                  : s));
              setRemotePick(null);
            }}
          />
        </div>
      )}
    >
      <ReadOnlyFields readOnly={readOnly} className="min-h-full p-4 flex flex-col gap-4">
        <div className="shrink-0">
          <label className={formLabelClass} style={formLabelStyle}>{t("mobile.snippetEdit.nameLabel")}</label>
          <input
            data-mobile-snippet-name
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("mobile.snippetEdit.namePlaceholder")}
            className={formInputClass}
            style={formInputStyle}
            {...nameField.fieldProps}
          />
          <FieldError show={nameField.invalid} />
        </div>
        {showStepList ? (
          <StepListEditor
            value={steps}
            onChange={setSteps}
            snippets={snippets.filter((s) => s.id !== editing?.id)}
            onBrowseRemote={(index, field, isDir) => setRemotePick({ index, field, isDir })}
          />
        ) : (
          <div className="flex-1 flex flex-col">
            <label className={formLabelClass} style={formLabelStyle}>{t("mobile.snippetEdit.contentLabel")}</label>
            <ScriptEditor
              value={content}
              onChange={(v) => setSteps([{ kind: "script", content: v }])}
              placeholder={t("mobile.snippetEdit.contentPlaceholder")}
              minHeight="10rem"
              fill
              className="flex-1"
              {...contentField.fieldProps}
            />
            <FieldError show={contentField.invalid} />
            <button
              type="button"
              onClick={() => setForceSequence(true)}
              className="self-start mt-1 h-10 px-1 flex items-center gap-1.5 text-sm font-medium text-(--t-accent)"
            >
              <Icon icon="lucide:list-plus" width={16} /> {t("snippets.step.addStep")}
            </button>
          </div>
        )}
        {editing && !readOnly && (
          <button
            data-mobile-snippet-delete
            onClick={() => { void deleteSnippet(editing.id); pop(); }}
            className="shrink-0 flex items-center justify-center gap-2 rounded-full h-12 text-sm font-medium"
            style={{ color: "var(--t-danger, #e5484d)", border: "1px solid var(--t-border)" }}
          >
            <Icon icon="lucide:trash-2" width={16} /> {t("mobile.snippetEdit.delete")}
          </button>
        )}
      </ReadOnlyFields>
    </MobileEditScreen>
  );
}
