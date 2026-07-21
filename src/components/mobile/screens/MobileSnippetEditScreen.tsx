import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useSnippetStore } from "@/stores/snippetStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { StepListEditor } from "@/components/snippets/StepListEditor";
import { RemotePathPickerPanel } from "@/components/snippets/RemotePathPickerPanel";
import type { SnippetFormData, SnippetStep } from "@/types";

export default function MobileSnippetEditScreen({ snippetId }: { snippetId?: string }) {
  const { t } = useTranslation();
  const pop = useMobileNavStore((s) => s.pop);
  const snippets = useSnippetStore((s) => s.snippets);
  const createSnippet = useSnippetStore((s) => s.createSnippet);
  const updateSnippet = useSnippetStore((s) => s.updateSnippet);
  const deleteSnippet = useSnippetStore((s) => s.deleteSnippet);
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const editing = snippetId ? snippets.find((s) => s.id === snippetId) ?? null : null;

  const [name, setName] = useState(editing?.name ?? "");
  const [steps, setSteps] = useState<SnippetStep[]>(editing?.steps ?? [{ kind: "script", content: "" }]);
  const [remotePick, setRemotePick] = useState<{ index: number; field: "from_path" | "to_path"; isDir: boolean } | null>(null);

  // Single-script fast path: keep the plain textarea when the snippet is just one script step.
  const [forceSequence, setForceSequence] = useState(false);
  const singleStep = steps.length === 1 && steps[0].kind === "script" ? steps[0] : null;
  const showStepList = forceSequence || !singleStep;
  const content = singleStep?.content ?? "";

  const canSave = name.trim().length > 0 && steps.some((s) => s.kind !== "script" || s.content.trim());

  const save = async () => {
    if (!canSave) return;
    if (editing) {
      const data: SnippetFormData = {
        name: name.trim(), steps,
        description: editing.description,
        tags: editing.tags, folder_id: editing.folder_id,
        favorite: editing.favorite,
        only_for_connection_tags: editing.only_for_connection_tags,
        only_for_distros: editing.only_for_distros,
        vault_id: editing.vault_id,
      };
      await updateSnippet(editing.id, data);
    } else {
      const data: SnippetFormData = {
        name: name.trim(), steps,
        tags: [], favorite: false,
        only_for_connection_tags: [], only_for_distros: [],
        vault_id: selectedVaultIds[0] ?? "personal",
      };
      await createSnippet(data);
    }
    pop();
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <header
        className="shrink-0 flex items-center gap-2 px-2 h-12 border-b"
        style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}
      >
        <button data-mobile-back onClick={pop} className="p-2 text-(--t-text-primary)">
          <Icon icon="lucide:arrow-left" width={22} />
        </button>
        <span className="flex-1 text-base font-semibold text-(--t-text-primary)">
          {editing ? t("mobile.snippetEdit.editTitle") : t("mobile.snippetEdit.newTitle")}
        </span>
        <button
          data-mobile-snippet-save
          onClick={() => void save()}
          disabled={!canSave}
          className="px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ background: "var(--t-accent)", color: "#fff", opacity: !canSave ? 0.5 : 1 }}
        >
          {t("common.action.save")}
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        <input
          data-mobile-snippet-name
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("mobile.snippetEdit.namePlaceholder")}
          className="shrink-0 rounded-xl px-3 h-10 text-sm outline-none text-(--t-text-primary)"
          style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
        />
        {showStepList ? (
          <StepListEditor
            value={steps}
            onChange={setSteps}
            snippets={snippets.filter((s) => s.id !== editing?.id)}
            onBrowseRemote={(index, field, isDir) => setRemotePick({ index, field, isDir })}
          />
        ) : (
          <div className="flex-1 flex flex-col gap-1.5">
            <textarea
              data-mobile-snippet-content
              value={content}
              onChange={(e) => setSteps([{ kind: "script", content: e.target.value }])}
              placeholder={t("mobile.snippetEdit.contentPlaceholder")}
              className="flex-1 min-h-40 rounded-xl px-3 py-2 text-sm font-mono outline-none resize-none text-(--t-text-primary)"
              style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
            />
            <button
              type="button"
              onClick={() => setForceSequence(true)}
              className="self-start text-xs"
              style={{ color: "var(--t-text-dim)" }}
            >
              {t("snippets.step.addStep")}
            </button>
          </div>
        )}
        {editing && (
          <button
            data-mobile-snippet-delete
            onClick={() => { void deleteSnippet(editing.id); pop(); }}
            className="shrink-0 flex items-center justify-center gap-2 rounded-xl h-10 text-sm font-medium"
            style={{ color: "var(--t-danger, #e5484d)", border: "1px solid var(--t-border)" }}
          >
            <Icon icon="lucide:trash-2" width={16} /> {t("mobile.snippetEdit.delete")}
          </button>
        )}
      </div>

      {remotePick && (
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
    </div>
  );
}
