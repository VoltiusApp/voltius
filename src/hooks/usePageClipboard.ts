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

  useEffect(() => {
    const isActive = () => useUIStore.getState().activeNav === navItem;

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
      const clipboard = useVaultClipboardStore.getState().clipboard;
      void pasteFromClipboard(clipboard, ref.current).then((result) => {
        if (clipboard?.mode === "cut" && result.moved > 0) {
          useVaultClipboardStore.getState().clear();
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
