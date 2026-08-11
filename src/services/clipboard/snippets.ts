import type { Snippet, SnippetFormData } from "@/types";
import type { VaultClipboardKind } from "@/stores/vaultClipboardStore";
import { snippetToForm } from "@/utils/snippetForm";
import { nameIsFree } from "@/utils/cloneName";
import type { ClipboardHalf } from "./types";

export interface SnippetsClipboardDeps {
  snippets: Snippet[];
  getSnippetsInFolderTree: (folderId: string) => Snippet[];
  vaultForFolder: (folderId: string | null) => string | null;
  updateSnippet: (id: string, form: SnippetFormData) => Promise<unknown>;
  duplicateSnippetInto: (
    snippet: Snippet,
    folderId: string | null,
    opts: { vaultId?: string; keepName: boolean },
  ) => Promise<{ id: string }>;
  deleteSnippet: (id: string) => Promise<unknown>;
}

export function snippetsClipboardHalf(deps: SnippetsClipboardDeps): ClipboardHalf {
  return {
    folderContentKinds: (folderId): VaultClipboardKind[] =>
      deps.getSnippetsInFolderTree(folderId).length > 0 ? ["snippet"] : [],
    // A snippet-call step points at another snippet by id. Moving the caller without
    // the callee leaves the call unresolvable from the destination vault. As on Port
    // Forwarding this cannot be a permission — both sides are EDIT_SNIPPETS. A callee
    // travelling in the same paste is fine, so it is excluded first.
    danglingKinds: (items, folderIds, destination): VaultClipboardKind[] => {
      const moved = [
        ...items.map((i) => deps.snippets.find((s) => s.id === i.id)).filter((s) => !!s),
        ...folderIds.flatMap((id) => deps.getSnippetsInFolderTree(id)),
      ];
      const movedIds = new Set(moved.map((s) => s.id));
      const callees = moved
        .flatMap((s) => s.steps)
        .filter((step) => step.kind === "snippet")
        .map((step) => step.snippet_id)
        .filter((id) => !movedIds.has(id))
        .map((id) => deps.snippets.find((s) => s.id === id))
        .filter((s) => !!s);
      return callees.some((s) => (s.vault_id ?? "personal") !== destination) ? ["snippet"] : [];
    },
    // A cross-vault move carries vault_id alongside folder_id, otherwise the snippet
    // would keep a stale vault_id next to its new folder's.
    moveItems: async (ids, folderId, vaultId) => {
      for (const id of ids) {
        const s = deps.snippets.find((x) => x.id === id);
        if (!s) continue;
        await deps.updateSnippet(id, {
          ...snippetToForm(s),
          folder_id: folderId ?? undefined,
          vault_id: vaultId ?? s.vault_id,
        });
      }
    },
    duplicateItems: async (ids, folderId) => {
      const targetVault = deps.vaultForFolder(folderId) ?? undefined;
      const created: string[] = [];
      for (const id of ids) {
        const s = deps.snippets.find((x) => x.id === id);
        if (!s) continue;
        created.push((await deps.duplicateSnippetInto(s, folderId, {
          vaultId: targetVault,
          keepName: nameIsFree(deps.snippets, s.name, targetVault ?? s.vault_id ?? "personal", folderId),
        })).id);
      }
      return created;
    },
    deleteItems: async (ids) => { for (const id of ids) await deps.deleteSnippet(id); },
  };
}
