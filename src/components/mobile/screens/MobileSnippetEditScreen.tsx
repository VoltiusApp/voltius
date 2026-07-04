import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useSnippetStore } from "@/stores/snippetStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { snippetScriptText } from "@/services/snippetSteps";
import type { SnippetFormData } from "@/types";

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
  const [content, setContent] = useState(editing ? snippetScriptText(editing) : "");

  const save = async () => {
    if (!name.trim() || !content.trim()) return;
    if (editing) {
      const data: SnippetFormData = {
        name: name.trim(), steps: [{ kind: "script", content }],
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
        name: name.trim(), steps: [{ kind: "script", content }],
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
          disabled={!name.trim() || !content.trim()}
          className="px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ background: "var(--t-accent)", color: "#fff", opacity: !name.trim() || !content.trim() ? 0.5 : 1 }}
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
        <textarea
          data-mobile-snippet-content
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t("mobile.snippetEdit.contentPlaceholder")}
          className="flex-1 min-h-40 rounded-xl px-3 py-2 text-sm font-mono outline-none resize-none text-(--t-text-primary)"
          style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
        />
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
    </div>
  );
}
