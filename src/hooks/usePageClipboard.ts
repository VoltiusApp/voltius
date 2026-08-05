import { useEffect, useRef } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useVaultClipboardStore, type VaultClipboardKind } from "@/stores/vaultClipboardStore";
import { pasteFromClipboard, type ClipboardAdapter } from "@/services/vaultClipboard";

export interface PageClipboardAdapter extends ClipboardAdapter {
  getSelection: () => string[];
  getFocusedId: () => string | null;
  classify: (id: string) => VaultClipboardKind | "folder" | null;
}

export function usePageClipboard(adapter: PageClipboardAdapter): void {
  const ref = useRef(adapter);
  ref.current = adapter;
  const navItem = adapter.navItem;
  // Serializes pastes so a second Ctrl+V queues behind an in-flight one
  // instead of racing it (each still re-reads the clipboard when it runs).
  const pasteChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const isActive = () => useUIStore.getState().activeNav === navItem;

    // pasteFromClipboard registers undo/redo entries that outlive the paste, so it
    // is handed a live view of the adapter instead of the render-time object. An
    // undo running against that snapshot would decide from pre-paste data — it
    // would see a moved object still in its old vault and skip restoring it.
    const live: ClipboardAdapter = {
      navItem,
      exists: (id) => ref.current.exists(id),
      vaultIdOf: (id) => ref.current.vaultIdOf(id),
      targetFolderId: () => ref.current.targetFolderId(),
      targetVaultId: () => ref.current.targetVaultId(),
      folderIdOf: (id) => ref.current.folderIdOf(id),
      folderContentKinds: (id) => ref.current.folderContentKinds(id),
      canMoveFolder: (id, parentFolderId) => ref.current.canMoveFolder(id, parentFolderId),
      moveItems: (ids, folderId, vaultId) => ref.current.moveItems(ids, folderId, vaultId),
      moveFolder: (id, parentFolderId, vaultId) => ref.current.moveFolder(id, parentFolderId, vaultId),
      duplicateItems: (ids, folderId) => ref.current.duplicateItems(ids, folderId),
      duplicateFolder: (id, parentFolderId) => ref.current.duplicateFolder(id, parentFolderId),
      deleteItems: (ids) => ref.current.deleteItems(ids),
      deleteFolder: (id) => ref.current.deleteFolder(id),
      setSelection: (ids) => ref.current.setSelection(ids),
      can: (permission, vaultId) => ref.current.can(permission, vaultId),
    };

    const fill = (mode: "copy" | "cut") => () => {
      if (!isActive()) return;
      const a = ref.current;
      const selection = a.getSelection();
      const ids = selection.length > 0 ? selection : [a.getFocusedId()].filter((x): x is string => !!x);
      if (ids.length === 0) return;

      const items: { id: string; kind: VaultClipboardKind }[] = [];
      const folderIds: string[] = [];
      for (const id of ids) {
        const kind = a.classify(id);
        if (kind === "folder") folderIds.push(id);
        else if (kind) items.push({ id, kind });
      }
      if (items.length === 0 && folderIds.length === 0) return;

      useVaultClipboardStore.getState().setClipboard({
        tab: navItem,
        mode,
        items,
        folderIds,
        sourceVaultIds: [...new Set(ids.map((id) => a.vaultIdOf(id)))],
      });
    };

    const handlePaste = () => {
      if (!isActive()) return;
      pasteChain.current = pasteChain.current.then(async () => {
        const clipboard = useVaultClipboardStore.getState().clipboard;
        try {
          const result = await pasteFromClipboard(clipboard, live);
          if (clipboard?.mode === "cut" && result.moved > 0) {
            useVaultClipboardStore.getState().clear();
          }
        } catch (e) {
          // Caught here so a rejected paste (IPC/network/permission failure)
          // can't poison pasteChain and stall every later paste on this page.
          console.error("clipboard paste failed:", e);
        }
      });
    };

    const onCopy = fill("copy");
    const onCut = fill("cut");
    window.addEventListener("voltius:clipboard-copy", onCopy);
    window.addEventListener("voltius:clipboard-cut", onCut);
    window.addEventListener("voltius:clipboard-paste", handlePaste);
    return () => {
      window.removeEventListener("voltius:clipboard-copy", onCopy);
      window.removeEventListener("voltius:clipboard-cut", onCut);
      window.removeEventListener("voltius:clipboard-paste", handlePaste);
    };
  }, [navItem]);
}
