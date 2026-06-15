import { useState } from "react";
import { Icon } from "@iconify/react";
import BottomSheet from "./BottomSheet";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useEffectivePinned } from "@/hooks/useEffectivePinned";
import { snippetToForm } from "@/utils/snippetForm";

type Mode = "menu" | "confirm-delete" | "move" | "copy";

type Item = { icon: string; label: string; danger?: boolean; onTap: () => void };

export default function MobileSnippetActionsSheet({ snippetId }: { snippetId: string }) {
  const closeSheet = useMobileNavStore((s) => s.closeSheet);
  const push = useMobileNavStore((s) => s.push);
  const snippet = useSnippetStore((s) => s.snippets.find((x) => x.id === snippetId));
  const createSnippet = useSnippetStore((s) => s.createSnippet);
  const updateSnippet = useSnippetStore((s) => s.updateSnippet);
  const deleteSnippet = useSnippetStore((s) => s.deleteSnippet);
  const pinSnippet = useSnippetStore((s) => s.pinSnippet);
  const vaults = useVaultStore((s) => s.vaults);
  // useEffectivePinned is a hook — must be called unconditionally BEFORE any early return
  const pinned = useEffectivePinned(snippet ?? ({} as never), "snippet");
  const [mode, setMode] = useState<Mode>("menu");

  if (!snippet) return null;
  const currentVaultId = snippet.vault_id ?? "personal";
  const vaultTargets = vaults.filter((v) => v.id !== currentVaultId);

  const Row = ({ it }: { it: Item }) => (
    <button
      data-snippet-action={it.label.toLowerCase().replace(/[^a-z]+/g, "-")}
      className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left active:bg-(--t-bg-card)"
      style={{ color: it.danger ? "var(--t-danger, #e5484d)" : "var(--t-text-primary)" }}
      onClick={it.onTap}
    >
      <Icon icon={it.icon} width={18} />
      <span className="text-sm font-medium">{it.label}</span>
    </button>
  );

  if (mode === "confirm-delete") {
    return (
      <BottomSheet title="Delete snippet?" onClose={closeSheet} registerBack={false}>
        <div className="px-3 pt-1 pb-2 text-sm text-(--t-text-dim)">
          Permanently delete <span className="text-(--t-text-primary) font-medium">{snippet.name}</span>? This can’t be undone.
        </div>
        <Row it={{ icon: "lucide:trash-2", label: "Delete", danger: true, onTap: () => { void deleteSnippet(snippetId); closeSheet(); } }} />
        <Row it={{ icon: "lucide:x", label: "Cancel", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  if (mode === "move" || mode === "copy") {
    const copy = mode === "copy";
    return (
      <BottomSheet title={copy ? "Copy to vault" : "Move to vault"} onClose={closeSheet} registerBack={false}>
        {vaultTargets.map((v) => (
          <Row key={v.id} it={{ icon: "lucide:vault", label: v.name, onTap: () => {
            if (copy) void createSnippet({ ...snippetToForm(snippet), name: `${snippet.name} (copy)`, vault_id: v.id, favorite: false });
            else void updateSnippet(snippetId, { ...snippetToForm(snippet), vault_id: v.id });
            closeSheet();
          } }} />
        ))}
        <Row it={{ icon: "lucide:arrow-left", label: "Back", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  const items: Item[] = [
    { icon: "lucide:pencil", label: "Edit", onTap: () => { closeSheet(); push({ kind: "snippet-edit", snippetId }); } },
    { icon: "lucide:copy", label: "Duplicate", onTap: () => {
        void createSnippet({ ...snippetToForm(snippet), name: `${snippet.name} (copy)`, favorite: false });
        closeSheet();
      } },
    { icon: pinned ? "lucide:pin-off" : "lucide:pin", label: pinned ? "Unpin" : "Pin", onTap: () => { void pinSnippet(snippetId, !pinned); closeSheet(); } },
    ...(vaultTargets.length > 0 ? [{ icon: "lucide:folder-input", label: "Move to vault", onTap: () => setMode("move") }] : []),
    ...(vaultTargets.length > 0 ? [{ icon: "lucide:copy-plus", label: "Copy to vault", onTap: () => setMode("copy") }] : []),
    { icon: "lucide:trash-2", label: "Delete", danger: true, onTap: () => setMode("confirm-delete") },
  ];

  return (
    <BottomSheet title={snippet.name} onClose={closeSheet} registerBack={false}>
      {items.map((it) => <Row key={it.label} it={it} />)}
    </BottomSheet>
  );
}
