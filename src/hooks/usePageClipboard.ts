import { useEffect, useRef } from "react";
import i18n from "@/i18n";
import { useUIStore } from "@/stores/uiStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useVaultClipboardStore, type VaultClipboardKind } from "@/stores/vaultClipboardStore";
import {
  pasteFromClipboard,
  runPaste,
  type CascadeEntry,
  type ClipboardAdapter,
  type PasteResult,
} from "@/services/vaultClipboard";

export interface PageClipboardAdapter extends ClipboardAdapter {
  getSelection: () => string[];
  getFocusedId: () => string | null;
  classify: (id: string) => VaultClipboardKind | "folder" | null;
  /** Asked before a paste that changes vault; false aborts the paste. */
  confirmCrossVault?: (summary: {
    count: number;
    targetVaultName: string;
    mode: "copy" | "cut";
    /** Referenced objects travelling with the paste, named so the move is not a surprise. */
    cascade: CascadeEntry[];
  }) => Promise<boolean>;
  targetVaultName?: () => string;
}

function toast(message: string, severity: "warning" | "error" = "warning") {
  useNotificationStore.getState().addToast({
    source: { kind: "plugin", id: "system", name: "Voltius" },
    type: "toast",
    message,
    severity,
    duration: 6000,
  });
}

/**
 * A refused pre-flight and vanished objects both end in a paste that changes
 * nothing, which is indistinguishable from a broken Ctrl+V unless it is said out loud.
 */
function reportPasteResult(result: PasteResult) {
  if (result.blocked && result.blocked.length > 0) {
    const permissions = result.blocked.map((p) => i18n.t(`members.permission.${p}`)).join(", ");
    toast(i18n.t("common.clipboard.pasteBlocked", { permissions }));
    return;
  }
  if (result.dangling && result.dangling.length > 0) {
    const kinds = result.dangling.map((k) => i18n.t(`common.clipboard.kind.${k}`)).join(", ");
    toast(i18n.t("common.clipboard.pasteWouldDangle", { kinds }));
    return;
  }
  if (result.crossVaultAtRoot) {
    toast(i18n.t("common.clipboard.pasteRootCrossVault"));
  }
  if (result.skipped > 0) {
    toast(i18n.t("common.clipboard.pasteSkipped", { count: result.skipped }));
  }
}

export function usePageClipboard(adapter: PageClipboardAdapter): void {
  const ref = useRef(adapter);
  ref.current = adapter;
  const navItem = adapter.navItem;

  useEffect(() => {
    const isActive = () => useUIStore.getState().activeNav === navItem;

    // The paste chain is shared by every page, so a confirmation whose UI is torn
    // down mid-prompt would wedge Ctrl+V on all of them. Losing this hook declines it.
    let abortConfirm!: () => void;
    const aborted = new Promise<false>((resolve) => {
      abortConfirm = () => resolve(false);
    });

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
      rootVaultIds: () => ref.current.rootVaultIds?.() ?? [],
      folderIdOf: (id) => ref.current.folderIdOf(id),
      folderContentKinds: (id) => ref.current.folderContentKinds(id),
      danglingKinds: (items, folderIds, destination) =>
        ref.current.danglingKinds?.(items, folderIds, destination) ?? [],
      planCascade: ref.current.planCascade
        ? (items, folderIds, destination, mode) =>
            ref.current.planCascade?.(items, folderIds, destination, mode) ?? []
        : undefined,
      applyCascade: ref.current.applyCascade
        ? (items, folderIds, destination, mode) =>
            ref.current.applyCascade!(items, folderIds, destination, mode)
        : undefined,
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
      void runPaste(async () => {
        const clipboard = useVaultClipboardStore.getState().clipboard;
        try {
          // Inside the queued work, not before it: the confirmation must not run
          // ahead of an in-flight paste and decide from pre-paste state.
          if (clipboard && clipboard.tab === navItem) {
            const a = ref.current;
            const target = a.targetVaultId();
            const ids = [...clipboard.items.map((i) => i.id), ...clipboard.folderIds];
            // A null target is the vault root, where every object keeps its vault.
            const crossesVaults = target !== null && ids.some((id) => a.vaultIdOf(id) !== target);
            if (crossesVaults && a.confirmCrossVault) {
              const ok = await Promise.race([
                a.confirmCrossVault({
                  count: ids.length,
                  // Falls back to the id when the vault is not in the page's options.
                  targetVaultName: a.targetVaultName?.() || target,
                  mode: clipboard.mode,
                  cascade:
                    a.planCascade?.(clipboard.items, clipboard.folderIds, target, clipboard.mode)
                    ?? [],
                }),
                aborted,
              ]);
              if (!ok) return;
            }
          }
          const result = await pasteFromClipboard(clipboard, live);
          reportPasteResult(result);
          // Only when nothing was left behind. A root paste that stranded part of
          // the selection keeps the clipboard so the rest can be pasted somewhere
          // that accepts it; clearing it would strand them for good. Vanished
          // objects (`skipped`) are not a reason to keep it — retrying cannot
          // bring them back.
          if (clipboard?.mode === "cut" && result.moved > 0 && !result.crossVaultAtRoot) {
            useVaultClipboardStore.getState().clear();
          }
        } catch (e) {
          // Caught here so a rejected paste (IPC/network/permission failure)
          // can't stall every later paste on this page.
          // Said out loud too: a swallowed rejection is a Ctrl+V that does nothing.
          console.error("clipboard paste failed:", e);
          toast(
            i18n.t("common.clipboard.pasteFailed", {
              error: e instanceof Error ? e.message : String(e),
            }),
            "error",
          );
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
      abortConfirm();
    };
  }, [navItem]);
}
