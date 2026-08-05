import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useUIStore } from "@/stores/uiStore";
import { useUIContributions } from "@/hooks/useUIContributions";

import { DragSelectSurface } from "@/components/shared/DragSelectSurface";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { VaultCascadeModal } from "@/components/shared/VaultCascadeModal";
import { useEffectivePinnedPredicate } from "@/hooks/useEffectivePinned";
import { useVaultCascade } from "@/hooks/useVaultCascade";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { usePermissions, type Permission } from "@/hooks/usePermission";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { useDefaultVaultId } from "@/hooks/useWritableVaultIds";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { usePageBulkActions } from "@/hooks/usePageBulkActions";
import { useDragToFolder } from "@/hooks/useDragToFolder";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { useFolderStore } from "@/stores/folderStore";
import { useAllIdentities } from "@/hooks/useAllIdentities";
import { useAllKeys } from "@/hooks/useAllKeys";
import { useAllFolders } from "@/hooks/useAllFolders";
import { FolderCard } from "@/components/folders/FolderCard";
import { FolderEditPanel } from "@/components/folders/FolderEditPanel";
import { Icon } from "@iconify/react";
import { KeychainToolbar } from "./KeychainToolbar";
import { KeySection, IdentitySection } from "./KeyCards";
import { KeyForm } from "./KeyForm";
import { IdentityForm } from "./IdentityForm";
import { KeyExportPanel, sortByMode } from "./KeyExportPanel";
import { getSecret, storeSecret, deleteSecret } from "@/services/vault";
import type { Folder, Identity, IdentityFormData, SshKey, SshKeyFormData, VaultOption } from "@/types";
import { SidePanelLayout } from "@/components/shared/SidePanelLayout";
import { useSyncedFormKey } from "@/hooks/useSyncedFormKey";
import { buildTeamVaultTransferPlan, type TransferOperation } from "@/services/teamVaultPermissions";
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";
import { usePageClipboard } from "@/hooks/usePageClipboard";
import { useCrossVaultPasteConfirm } from "@/hooks/useCrossVaultPasteConfirm";
import { ClipboardPill } from "@/components/shared/ClipboardPill";
import { useVaultClipboardStore, type VaultClipboardKind } from "@/stores/vaultClipboardStore";
import { getShortcutHint } from "@/stores/shortcutStore";

export default function KeychainPage() {
  const { t } = useTranslation();
  const { loadIdentities, saveIdentity, updateIdentity, deleteIdentity } =
    useIdentityStore();
  const identities = useAllIdentities();
  const { loadKeys, saveKey, updateKey, deleteKey } = useKeyStore();
  const keys = useAllKeys();
  const { pending: cascadePending, request: requestCascade, confirm: confirmCascade, cancel: cancelCascade } = useVaultCascade();
  const crossVaultPaste = useCrossVaultPasteConfirm();
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const bgContributions = useUIContributions("keychain.bgContextMenu");
  const keychainPendingAction = useUIStore((s) => s.keychainPendingAction);
  const setKeychainPendingAction = useUIStore((s) => s.setKeychainPendingAction);

  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const editingKey = editingKeyId ? (keys.find((k) => k.id === editingKeyId) ?? null) : null;
  const [editingIdentityId, setEditingIdentityId] = useState<string | null>(null);
  const editingIdentity = editingIdentityId ? (identities.find((i) => i.id === editingIdentityId) ?? null) : null;
  const inlineKeyIdRef = useRef<string | null>(null);
  const keyFormFlushRef = useRef<(() => void) | null>(null);
  const identityFormFlushRef = useRef<(() => void) | null>(null);
  const keyFormIsDirtyRef = useRef(false);
  const identityFormIsDirtyRef = useRef(false);
  const keyFormSessionKeyRef = useRef<string>("new-key");
  const identityFormSessionKeyRef = useRef<string>("new-identity");
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [keyFormMode, setKeyFormMode] = useState<"import" | "generate">("import");
  const [showIdentityForm, setShowIdentityForm] = useState(false);
  const keyFormVersion = useSyncedFormKey(editingKey?.updated_at, showKeyForm, () => keyFormIsDirtyRef.current);
  const identityFormVersion = useSyncedFormKey(editingIdentity?.updated_at, showIdentityForm, () => identityFormIsDirtyRef.current);
  const [exportingKey, setExportingKey] = useState<SshKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const layoutMode = useUIStore((s) => s.keychainLayoutMode);
  const setLayoutMode = useUIStore((s) => s.setKeychainLayoutMode);
  const sortMode = useUIStore((s) => s.keychainSortMode);
  const setSortMode = useUIStore((s) => s.setKeychainSortMode);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const { loadFolders, saveFolder, updateFolder, deleteFolder, moveObjectsToFolder, moveFolder } = useFolderStore();
  const folders = useAllFolders();

  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const accessibleVaultIds = useAccessibleVaultIds();
  const defaultVaultId = useDefaultVaultId();
  const can = usePermissions();
  const canEditKeys = selectedVaultIds.some((vid) => can("EDIT_KEYS", vid));
  const canEditIdentities = selectedVaultIds.some((vid) => can("EDIT_IDENTITIES", vid));

  const vaultOptions = useMemo<VaultOption[]>(() => {
    const linkedTeamIds = new Set(vaults.map((v) => v.teamId).filter(Boolean));
    return [
      { id: "personal", name: "Personal" },
      ...vaults.filter((v) => v.id !== "personal").map((v) => ({ id: v.teamId ?? v.id, name: v.name })),
      ...teams.filter((t) => !linkedTeamIds.has(t.id)).map((t) => ({ id: t.id, name: t.name })),
    ];
  }, [vaults, teams]);
  const q = useMemo(() => search.trim().toLowerCase(), [search]);
  const scopedFolders = useMemo(
    () => folders.filter((f) => {
      if (f.object_type !== "keychain") return false;
      const fvid = f.vault_id ?? "personal";
      return accessibleVaultIds.length === 0 || accessibleVaultIds.includes(fvid);
    }),
    [folders, accessibleVaultIds],
  );
  const scopedFolderIds = useMemo(() => new Set(scopedFolders.map((f) => f.id)), [scopedFolders]);
  const editingFolder = editingFolderId ? scopedFolders.find((f) => f.id === editingFolderId) ?? null : null;

  const {
    folderPath,
    activeFolderId,
    ejectTargetFolderId,
    visibleFolders,
    navigateInto,
    navigateTo,
    navigateToRoot,
    onFolderDeleted,
  } = useFolderNavigation(scopedFolders);

  const availableTags = useMemo(
    () => [...new Set([...keys.flatMap((k) => k.tags), ...identities.flatMap((i) => i.tags)])].sort(),
    [keys, identities],
  );

  const filteredKeys = useMemo(() =>
    sortByMode(keys.filter((k) => {
      const kvid = k.vault_id ?? "personal";
      if (accessibleVaultIds.length > 0 && !accessibleVaultIds.includes(kvid)) return false;
      if (q && !(k.name ?? "").toLowerCase().includes(q) && !(k.key_type ?? "").toLowerCase().includes(q)) return false;
      if (tagFilter.length > 0 && !tagFilter.some((t) => k.tags.includes(t))) return false;
      if (activeFolderId) return k.folder_id === activeFolderId;
      return scopedFolders.length === 0 || !k.folder_id || !scopedFolderIds.has(k.folder_id);
    }), sortMode),
    [keys, q, sortMode, tagFilter, activeFolderId, scopedFolders, scopedFolderIds, accessibleVaultIds],
  );
  const filteredIdentities = useMemo(() =>
    sortByMode(
      identities.filter((i) => {
        const ivid = i.vault_id ?? "personal";
        if (accessibleVaultIds.length > 0 && !accessibleVaultIds.includes(ivid)) return false;
        if (q && !(i.name ?? "").toLowerCase().includes(q) && !i.username.toLowerCase().includes(q)) return false;
        if (tagFilter.length > 0 && !tagFilter.some((t) => i.tags.includes(t))) return false;
        if (activeFolderId) return i.folder_id === activeFolderId;
        return scopedFolders.length === 0 || !i.folder_id || !scopedFolderIds.has(i.folder_id);
      }),
      sortMode,
    ),
    [identities, q, sortMode, tagFilter, activeFolderId, scopedFolders, scopedFolderIds, accessibleVaultIds],
  );

  const showPanel = showKeyForm || showIdentityForm || exportingKey !== null;

  // Refs for stable onSelect callbacks (avoid re-creating per render)
  const showPanelRef = useRef(showPanel);
  showPanelRef.current = showPanel;
  const filteredKeysRef = useRef(filteredKeys);
  filteredKeysRef.current = filteredKeys;
  const filteredIdentitiesRef = useRef(filteredIdentities);
  filteredIdentitiesRef.current = filteredIdentities;

  const orderedIds = useMemo(
    () => [...visibleFolders.map((f) => f.id), ...filteredKeys.map((k) => k.id), ...filteredIdentities.map((i) => i.id)],
    [visibleFolders, filteredKeys, filteredIdentities],
  );

  const isPinnedFn = useEffectivePinnedPredicate();
  const pinnedKeys = useMemo(
    () => (!q && !activeFolderId) ? filteredKeys.filter((k) => isPinnedFn(k, "key")) : [],
    [filteredKeys, q, activeFolderId, isPinnedFn],
  );
  const pinnedIdentities = useMemo(
    () => (!q && !activeFolderId) ? filteredIdentities.filter((i) => isPinnedFn(i, "identity")) : [],
    [filteredIdentities, q, activeFolderId, isPinnedFn],
  );
  const { selectedIdSet, selectionAreaRef, itemAreaRef, dragBox, handleItemSelect, handleSelectionAreaMouseDown, selectSingle, setSelection } =
    useDragSelection(orderedIds);

  const { focusedId, setFocusedId } = useListKeyNav({
    orderedIds,
    selectedIdSet,
    selectSingle,
    setSelection,
    itemAreaRef,
    layoutMode,
    onEnter: (id) => {
      const folder = visibleFolders.find((f) => f.id === id);
      if (folder) { navigateInto(folder); return; }
      const key = keys.find((k) => k.id === id);
      if (key) { keyFormSessionKeyRef.current = key.id; setEditingKeyId(key.id); setShowKeyForm(true); return; }
      const identity = identities.find((i) => i.id === id);
      if (identity) { identityFormSessionKeyRef.current = identity.id; setEditingIdentityId(identity.id); setShowIdentityForm(true); }
    },
    onEdit: (id) => {
      const key = keys.find((k) => k.id === id);
      if (key) { keyFormSessionKeyRef.current = key.id; setEditingKeyId(key.id); setShowKeyForm(true); return; }
      const identity = identities.find((i) => i.id === id);
      if (identity) { identityFormSessionKeyRef.current = identity.id; setEditingIdentityId(identity.id); setShowIdentityForm(true); }
    },
    onEscape: () => {
      if (showPanel) { setShowKeyForm(false); setShowIdentityForm(false); setExportingKey(null); }
      else setSelection([]);
    },
    onSearch: () => setOmniOpen(true),
    onBackspace: () => { if (activeFolderId) navigateToRoot(); },
  });

  useEffect(() => { setFocusedId(null); }, [activeFolderId]);

  // ── Drag-to-folder ────────────────────────────────────────────────────────

  const visibleFolderIds = useMemo(() => new Set(visibleFolders.map((f) => f.id)), [visibleFolders]);
  const keyIdSet = useMemo(() => new Set(keys.map((k) => k.id)), [keys]);

  const dropHandler = async (ids: string[], folderId: string | null) => {
    const dragKeyIds = ids.filter((id) => keyIdSet.has(id));
    const identityIds = ids.filter((id) => !keyIdSet.has(id));
    if (dragKeyIds.length > 0) await moveObjectsToFolder(dragKeyIds, "key", folderId);
    if (identityIds.length > 0) await moveObjectsToFolder(identityIds, "identity", folderId);
    await loadKeys();
    await loadIdentities();
  };

  const {
    isDragging,
    dragOverFolderId,
    dragOverEject,
    handleDragStart,
    handleFolderDragStart,
    folderDropProps,
    ejectDropProps,
  } = useDragToFolder({
    selectedIdSet,
    folderIds: visibleFolderIds,
    onDropToFolder: async (ids, folderId) => {
      try { await dropHandler(ids, folderId); }
      catch (err) { setError(String(err)); }
    },
    onEject: async (ids, targetFolderId) => {
      try { await dropHandler(ids, targetFolderId); }
      catch (err) { setError(String(err)); }
    },
    onMoveFolders: async (folderDragIds, targetParentId) => {
      try {
        for (const id of folderDragIds) await moveFolder(id, targetParentId);
        await loadFolders();
      } catch (err) { setError(String(err)); }
    },
    onEjectFolders: async (folderDragIds, targetParentId) => {
      try {
        for (const id of folderDragIds) await moveFolder(id, targetParentId);
        await loadFolders();
      } catch (err) { setError(String(err)); }
    },
  });

  const { pos: bgMenuPos, open: openBgMenu, close: closeBgMenu } = useContextMenu();
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);

  const excludedIds = useSyncPrefsStore((s) => s.excludedIds);
  const syncTypes = useSyncPrefsStore((s) => s.syncTypes);

  const selectedKeyIds = useMemo(
    () => filteredKeys.filter((k) => selectedIdSet.has(k.id)).map((k) => k.id),
    [filteredKeys, selectedIdSet],
  );
  const selectedIdentityIds = useMemo(
    () => filteredIdentities.filter((i) => selectedIdSet.has(i.id)).map((i) => i.id),
    [filteredIdentities, selectedIdSet],
  );
  const selectedFolders = useMemo(
    () => visibleFolders.filter((f) => selectedIdSet.has(f.id)),
    [visibleFolders, selectedIdSet],
  );

  const bulkContextMenuItems = useMemo<ContextMenuItem[] | undefined>(() => {
    if (selectedIdSet.size <= 1) return undefined;
    const allIds = [...selectedIdSet];
    const selectedKeys = filteredKeys.filter((k) => selectedIdSet.has(k.id));
    const selectedIdentities = filteredIdentities.filter((i) => selectedIdSet.has(i.id));
    const selectedFolderIds = selectedFolders.map((f) => f.id);
    const { isObjectSynced } = useSyncPrefsStore.getState();
    const allSynced = allIds.every((id) => {
      const typeId = selectedKeyIds.includes(id) ? "key" : "identity";
      return isObjectSynced(id, typeId);
    });
    const bulkVaultChildren = (operation: TransferOperation): ContextMenuItem[] => vaultOptions
      .filter((v) => [...selectedKeys.map((k) => k.vault_id ?? "personal"), ...selectedIdentities.map((i) => i.vault_id ?? "personal"), ...selectedFolders.map((f) => f.vault_id ?? "personal")].some((sourceVaultId) => sourceVaultId !== v.id))
      .filter((v) => buildTeamVaultTransferPlan({
        operation,
        targetVaultId: v.id,
        selected: { keyIds: selectedKeyIds, identityIds: selectedIdentityIds, folderIds: selectedFolderIds },
        can: (permission, vaultId) => can(permission, vaultId),
        connections: [],
        identities,
        keys,
        folders: scopedFolders,
        snippets: [],
        snippetFolders: [],
      }).allowed)
      .map((v) => ({
        label: v.name,
        icon: operation === "move" ? "lucide:vault" : "lucide:copy-plus",
        onClick: () => {
          if (operation === "move") {
            for (const folder of selectedFolders) handleMoveFolderToVault(folder, v.id);
            for (const key of selectedKeys) void handleMoveKeyToVault(key, v.id);
            for (const identity of selectedIdentities) handleMoveIdentityToVault(identity, v.id);
          } else {
            for (const folder of selectedFolders) handleCopyFolderToVault(folder, v.id);
            for (const key of selectedKeys) void handleCopyKeyToVault(key, v.id);
            for (const identity of selectedIdentities) handleCopyIdentityToVault(identity, v.id);
          }
        },
      }));
    const moveChildren = bulkVaultChildren("move");
    const copyChildren = bulkVaultChildren("copy");
    const items: ContextMenuItem[] = [
      ...(moveChildren.length > 0 ? [{
        label: t("keychain.page.bulk.moveItemsTo", { count: allIds.length }),
        icon: "lucide:vault",
        children: moveChildren,
      }] : []),
      ...(copyChildren.length > 0 ? [{
        label: t("keychain.page.bulk.copyItemsTo", { count: allIds.length }),
        icon: "lucide:copy-plus",
        children: copyChildren,
      }] : []),
      {
        label: allSynced
          ? t("keychain.page.bulk.disableCloudSync", { count: allIds.length })
          : t("keychain.page.bulk.enableCloudSync", { count: allIds.length }),
        icon: allSynced ? "lucide:cloud-off" : "lucide:cloud",
        onClick: () => {
          const store = useSyncPrefsStore.getState();
          for (const id of allIds) {
            const typeId = selectedKeyIds.includes(id) ? "key" : "identity";
            const isSynced = store.isObjectSynced(id, typeId);
            if (allSynced && isSynced) store.toggleExcluded(id);
            else if (!allSynced && !isSynced) store.toggleExcluded(id);
          }
        },
      },
    ];
    if (selectedKeyIds.length > 0) {
      items.push({
        label: t("keychain.page.bulk.exportPublicKeys", { count: selectedKeyIds.length }),
        icon: "lucide:upload",
        onClick: () => useUIStore.getState().openImportExport("export", { bulk: { keys: selectedKeyIds, identities: selectedIdentityIds } }),
      });
    }
    items.push(
      {
        label: t("common.action.cut"),
        icon: "lucide:scissors",
        shortcut: getShortcutHint("cut"),
        onClick: () => window.dispatchEvent(new CustomEvent("voltius:clipboard-cut")),
        divider: true,
      },
      {
        label: t("common.action.copy"),
        icon: "lucide:copy",
        shortcut: getShortcutHint("copy"),
        onClick: () => window.dispatchEvent(new CustomEvent("voltius:clipboard-copy")),
      },
    );
    items.push({
      label: t("keychain.page.bulk.deleteItems", { count: allIds.length }),
      icon: "lucide:trash-2",
      onClick: () => setConfirmDeleteIds(allIds),
      danger: true,
      divider: true,
    });
    return items;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdSet, filteredKeys, filteredIdentities, selectedKeyIds, selectedIdentityIds, selectedFolders, excludedIds, syncTypes, vaultOptions, can, identities, keys, scopedFolders, t]);

  useEffect(() => {
    void loadKeys();
    void loadIdentities();
    void loadFolders();
  }, [loadKeys, loadIdentities, loadFolders]);

  usePageBulkActions({
    navItem: "keychain",
    filteredIds: orderedIds,
    selectedIdSet,
    setSelection,
    onDelete: (ids) => setConfirmDeleteIds(ids),
  });

  // ── Cut / copy / paste ────────────────────────────────────────────────────

  const clipboard = useVaultClipboardStore((s) => s.clipboard);
  const cutIds = useMemo(
    () =>
      new Set(
        clipboard?.tab === "keychain" && clipboard.mode === "cut"
          ? [...clipboard.items.map((i) => i.id), ...clipboard.folderIds]
          : [],
      ),
    [clipboard],
  );

  /**
   * The destination folder is the only unambiguous carrier of a destination vault.
   * At the root there is none, so nothing migrates and every object keeps its own
   * vault — matching the drag-to-root path, and avoiding a "move to top level"
   * gesture silently pulling a subtree out of a team vault. Derived from the folder
   * argument rather than activeFolderId so an undo, which passes the origin folder
   * back in, migrates back to the vault it came from.
   */
  const vaultForFolder = (folderId: string | null): string | null =>
    folderId ? (scopedFolders.find((f) => f.id === folderId)?.vault_id ?? null) : null;

  // Every mutation below goes through a store method so vault permission checks apply.
  usePageClipboard({
    navItem: "keychain",
    getSelection: () => [...selectedIdSet],
    getFocusedId: () => focusedId,
    classify: (id) =>
      scopedFolders.some((f) => f.id === id)
        ? "folder"
        : keys.some((k) => k.id === id)
        ? "key"
        : identities.some((i) => i.id === id)
        ? "identity"
        : null,
    exists: (id) =>
      keys.some((k) => k.id === id)
      || identities.some((i) => i.id === id)
      || scopedFolders.some((f) => f.id === id),
    vaultIdOf: (id) =>
      keys.find((k) => k.id === id)?.vault_id
      ?? identities.find((i) => i.id === id)?.vault_id
      ?? scopedFolders.find((f) => f.id === id)?.vault_id
      ?? "personal",
    targetFolderId: () => activeFolderId,
    targetVaultId: () => vaultForFolder(activeFolderId),
    targetVaultName: () =>
      vaultOptions.find((v) => v.id === vaultForFolder(activeFolderId))?.name ?? "",
    confirmCrossVault: crossVaultPaste.confirmCrossVault,
    folderIdOf: (id) =>
      keys.find((k) => k.id === id)?.folder_id
      ?? identities.find((i) => i.id === id)?.folder_id
      ?? scopedFolders.find((f) => f.id === id)?.parent_folder_id
      ?? null,
    folderContentKinds: (folderId) => {
      const treeKeys = keysInFolderTree(folderId);
      const treeIdentities = identitiesInFolderTree(folderId);
      const kinds: VaultClipboardKind[] = [];
      if (treeKeys.length > 0) kinds.push("key");
      if (treeIdentities.length > 0) kinds.push("identity");
      const destination = vaultForFolder(activeFolderId);
      if (destination === null || kinds.includes("key")) return kinds;
      // A migrated identity keeps pointing at its key, which this path does not
      // move — only the vault move/copy menu cascades that, behind VaultCascadeModal.
      // Reporting the key makes the pre-flight refuse the paste rather than complete
      // it with the reference dangling outside the destination.
      const linkedKeys = treeIdentities
        .map((i) => i.key_id && keys.find((k) => k.id === i.key_id))
        .filter((k) => !!k);
      if (linkedKeys.some((k) => (k.vault_id ?? "personal") !== destination)) kinds.push("key");
      return kinds;
    },
    canMoveFolder: (id, parentFolderId) =>
      parentFolderId !== id
      && !(parentFolderId !== null && getAllSubFolders(id).some((f) => f.id === parentFolderId)),
    can: (permission, vaultId) => can(permission as Permission, vaultId),
    // moveObjectsToFolder takes a single object_type, so the ids are partitioned by
    // kind. A same-vault move only rewrites folder_id; a cross-vault one has to go
    // through updateKey/updateIdentity so the object actually changes vault, otherwise
    // it would keep a stale vault_id alongside its new folder's.
    moveItems: async (ids, folderId, vaultId) => {
      const sameVaultKeys: string[] = [];
      const sameVaultIdentities: string[] = [];
      for (const id of ids) {
        const key = keys.find((k) => k.id === id);
        if (key) {
          if (vaultId === null || (key.vault_id ?? "personal") === vaultId) {
            sameVaultKeys.push(id);
            continue;
          }
          await updateKey(id, {
            name: key.name, key_type: key.key_type, tags: key.tags,
            folder_id: folderId ?? undefined, vault_id: vaultId,
          });
          await publishKeySecrets(id, vaultId);
          continue;
        }
        const identity = identities.find((i) => i.id === id);
        if (!identity) continue;
        if (vaultId === null || (identity.vault_id ?? "personal") === vaultId) {
          sameVaultIdentities.push(id);
          continue;
        }
        await updateIdentity(id, {
          name: identity.name, username: identity.username, key_id: identity.key_id,
          tags: identity.tags, folder_id: folderId ?? undefined, vault_id: vaultId,
        });
        await publishIdentitySecrets(id, vaultId);
      }
      // moveObjectsToFolder writes through to the DB without touching the key/identity
      // stores, so each touched store is reloaded — as in `dropHandler`.
      if (sameVaultKeys.length > 0) {
        await moveObjectsToFolder(sameVaultKeys, "key", folderId);
        await loadKeys();
      }
      if (sameVaultIdentities.length > 0) {
        await moveObjectsToFolder(sameVaultIdentities, "identity", folderId);
        await loadIdentities();
      }
    },
    moveFolder: async (id, parentFolderId, vaultId) => {
      const folder = scopedFolders.find((f) => f.id === id);
      if (!folder) return;
      if (vaultId !== null && (folder.vault_id ?? "personal") !== vaultId) {
        await migrateFolderTreeToVault(folder, parentFolderId, vaultId);
        return;
      }
      await moveFolder(id, parentFolderId);
    },
    duplicateItems: async (ids, folderId) => {
      const targetVault = vaultForFolder(folderId) ?? undefined;
      const created = new Map<string, string>();
      // Keys first, as in copyFolderInto: an identity cloned alongside its key must
      // point at the clone, not back at the original in the source vault.
      const keyIdMap = new Map<string, string>();
      for (const id of ids) {
        const key = keys.find((k) => k.id === id);
        if (!key) continue;
        const dup = await duplicateKeyInto(key, folderId, { vaultId: targetVault });
        keyIdMap.set(key.id, dup.id);
        created.set(id, dup.id);
      }
      for (const id of ids) {
        const identity = identities.find((i) => i.id === id);
        if (!identity) continue;
        const dup = await duplicateIdentityInto(identity, folderId, {
          vaultId: targetVault,
          keyId: identity.key_id ? (keyIdMap.get(identity.key_id) ?? identity.key_id) : undefined,
        });
        created.set(id, dup.id);
      }
      return ids.map((id) => created.get(id)).filter((id): id is string => !!id);
    },
    duplicateFolder: async (id, parentFolderId) =>
      (await copyFolderInto(id, parentFolderId, vaultForFolder(parentFolderId) ?? undefined)).id,
    // The store methods directly, not handleDeleteKey/handleDeleteIdentity: those
    // swallow the error into the banner, which would let a failed undo report success.
    deleteItems: async (ids) => {
      for (const id of ids) {
        if (keys.some((k) => k.id === id)) await deleteKey(id);
        else if (identities.some((i) => i.id === id)) await deleteIdentity(id);
      }
    },
    deleteFolder: async (id) => { await deleteFolder(id); },
    setSelection,
  });

  useEffect(() => {
    if (!keychainPendingAction) return;
    if (keychainPendingAction.action === "create-key") {
      keyFormSessionKeyRef.current = `new-key-${Date.now()}`;
      setKeyFormMode("import");
      setEditingKeyId(null);
      setShowKeyForm(true);
    } else if (keychainPendingAction.action === "create-identity") {
      identityFormSessionKeyRef.current = `new-identity-${Date.now()}`;
      setEditingIdentityId(null);
      setShowIdentityForm(true);
    } else if (keychainPendingAction.action === "edit-key") {
      const key = keys.find((k) => k.id === keychainPendingAction.id);
      if (key) { keyFormSessionKeyRef.current = key.id; setEditingKeyId(key.id); setShowKeyForm(true); }
    } else if (keychainPendingAction.action === "edit-identity") {
      const identity = identities.find((i) => i.id === keychainPendingAction.id);
      if (identity) { identityFormSessionKeyRef.current = identity.id; setEditingIdentityId(identity.id); setShowIdentityForm(true); }
    }
    setKeychainPendingAction(null);
  }, [keychainPendingAction, keys, identities, setKeychainPendingAction]);

  const handleKeySubmit = async (data: SshKeyFormData, privateKey: string | null, publicKey: string | null, passphrase: string | null) => {
    try {
      if (editingKey) {
        await updateKey(editingKey.id, data);
        if (privateKey !== null) {
          const localKey = `key:${editingKey.id}:private`;
          if (privateKey) {
            await storeSecret(localKey, privateKey);
            await saveTeamVaultSecretForVault(data.vault_id ?? editingKey.vault_id, localKey, privateKey).catch(() => {});
          } else await deleteSecret(localKey).catch(() => {});
        }
        if (publicKey !== null) {
          const localKey = `key:${editingKey.id}:public`;
          if (publicKey) {
            await storeSecret(localKey, publicKey);
            await saveTeamVaultSecretForVault(data.vault_id ?? editingKey.vault_id, localKey, publicKey).catch(() => {});
          } else await deleteSecret(localKey).catch(() => {});
        }
        if (passphrase !== null) {
          const localKey = `key:${editingKey.id}:passphrase`;
          if (passphrase) {
            await storeSecret(localKey, passphrase);
            await saveTeamVaultSecretForVault(data.vault_id ?? editingKey.vault_id, localKey, passphrase).catch(() => {});
          } else await deleteSecret(localKey).catch(() => {});
        }
      } else {
        const key = await saveKey(data);
        if (privateKey) {
          const localKey = `key:${key.id}:private`;
          await storeSecret(localKey, privateKey);
          await saveTeamVaultSecretForVault(key.vault_id, localKey, privateKey).catch(() => {});
        }
        if (publicKey) {
          const localKey = `key:${key.id}:public`;
          await storeSecret(localKey, publicKey);
          await saveTeamVaultSecretForVault(key.vault_id, localKey, publicKey).catch(() => {});
        }
        if (passphrase) {
          const localKey = `key:${key.id}:passphrase`;
          await storeSecret(localKey, passphrase);
          await saveTeamVaultSecretForVault(key.vault_id, localKey, passphrase).catch(() => {});
        }
        setEditingKeyId(key.id);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleIdentitySubmit = async (
    data: IdentityFormData,
    password: string | null,
    inlineKeyMaterial?: { label?: string; privateKey: string; publicKey: string },
  ) => {
    try {
      let resolvedData = data;

      if (inlineKeyMaterial?.privateKey) {
        const { label, privateKey, publicKey } = inlineKeyMaterial;
        const keyData = { name: label || undefined, key_type: undefined, tags: [] };
        if (inlineKeyIdRef.current) {
          await updateKey(inlineKeyIdRef.current, keyData);
          await storeSecret(`key:${inlineKeyIdRef.current}:private`, privateKey);
          if (publicKey) await storeSecret(`key:${inlineKeyIdRef.current}:public`, publicKey);
        } else {
          const createdKey = await saveKey(keyData);
          await storeSecret(`key:${createdKey.id}:private`, privateKey);
          if (publicKey) await storeSecret(`key:${createdKey.id}:public`, publicKey);
          inlineKeyIdRef.current = createdKey.id;
        }
        resolvedData = { ...data, key_id: inlineKeyIdRef.current! };
      }

      if (editingIdentity) {
        await updateIdentity(editingIdentity.id, resolvedData);
        if (password !== null) {
          const localKey = `identity:${editingIdentity.id}:password`;
          if (password) {
            await storeSecret(localKey, password);
            await saveTeamVaultSecretForVault(resolvedData.vault_id ?? editingIdentity.vault_id, localKey, password).catch(() => {});
          } else await deleteSecret(localKey).catch(() => {});
        }
      } else {
        const identity = await saveIdentity(resolvedData);
        if (password) {
          const localKey = `identity:${identity.id}:password`;
          await storeSecret(localKey, password);
          await saveTeamVaultSecretForVault(identity.vault_id, localKey, password).catch(() => {});
        }
        setEditingIdentityId(identity.id);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDeleteKey = async (id: string) => {
    try {
      await deleteKey(id);
      if (editingKey?.id === id) { setEditingKeyId(null); setShowKeyForm(false); }
    } catch (err) { setError(String(err)); }
  };

  const handleDeleteIdentity = async (id: string) => {
    try {
      await deleteIdentity(id);
      if (editingIdentity?.id === id) { setEditingIdentityId(null); setShowIdentityForm(false); }
    } catch (err) { setError(String(err)); }
  };

  const openKeyForm = (key: SshKey | null, mode: "import" | "generate" = "import") => {
    keyFormIsDirtyRef.current = false;
    keyFormSessionKeyRef.current = key?.id ?? `new-key-${Date.now()}`;
    setKeyFormMode(key ? "import" : mode);
    setEditingKeyId(key?.id ?? null);
    if (key) selectSingle(key.id);
    setShowKeyForm(true);
    setShowIdentityForm(false);
    setExportingKey(null);
    setEditingIdentityId(null);
  };

  const openKeyGenForm = () => openKeyForm(null, "generate");

  const openIdentityForm = (identity: Identity | null) => {
    identityFormIsDirtyRef.current = false;
    identityFormSessionKeyRef.current = identity?.id ?? `new-identity-${Date.now()}`;
    setEditingIdentityId(identity?.id ?? null);
    if (identity) selectSingle(identity.id);
    setShowIdentityForm(true);
    setShowKeyForm(false);
    setEditingKeyId(null);
  };

  // Per-folder item counts (keys + identities)
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const k of keys) if (k.folder_id) counts[k.folder_id] = (counts[k.folder_id] ?? 0) + 1;
    for (const i of identities) if (i.folder_id) counts[i.folder_id] = (counts[i.folder_id] ?? 0) + 1;
    return counts;
  }, [keys, identities]);

  const openExportPanel = (key: SshKey) => {
    setExportingKey(key);
    setShowKeyForm(false);
    setShowIdentityForm(false);
    setEditingKeyId(null);
    setEditingIdentityId(null);
  };

  const closePanel = () => {
    setShowKeyForm(false);
    setShowIdentityForm(false);
    setExportingKey(null);
    setEditingKeyId(null);
    inlineKeyIdRef.current = null;
    setEditingIdentityId(null);
  };

  const handleMoveKeyToVault = async (key: SshKey, vaultId: string) => {
    try { await updateKey(key.id, { name: key.name, key_type: key.key_type, tags: key.tags, folder_id: key.folder_id, vault_id: vaultId }); }
    catch (err) { setError(String(err)); }
  };

  const handleCopyKeyToVault = async (key: SshKey, vaultId: string) => {
    try {
      const newKey = await saveKey({ name: key.name, key_type: key.key_type, tags: key.tags, vault_id: vaultId });
      const [priv, pub, pass] = await Promise.all([
        getSecret(`key:${key.id}:private`).catch(() => null),
        getSecret(`key:${key.id}:public`).catch(() => null),
        getSecret(`key:${key.id}:passphrase`).catch(() => null),
      ]);
      if (priv) await storeSecret(`key:${newKey.id}:private`, priv);
      if (pub) await storeSecret(`key:${newKey.id}:public`, pub);
      if (pass) await storeSecret(`key:${newKey.id}:passphrase`, pass);
    } catch (err) { setError(String(err)); }
  };

  const handleMoveIdentityToVault = (identity: Identity, vaultId: string) => {
    const key = identity.key_id ? keys.find((k) => k.id === identity.key_id) : undefined;
    const keyNeedsMove = key && (key.vault_id ?? "personal") !== vaultId;
    const targetVaultName = vaultOptions.find((v) => v.id === vaultId)?.name ?? vaultId;

    requestCascade({
      operation: "move",
      targetVaultName,
      // "Unnamed key" default name kept in English until all creation sites are localized together (see i18n issue #14)
      items: keyNeedsMove ? [{ type: "key" as const, label: key.name ?? "Unnamed key" }] : [],
      execute: async () => {
        try {
          if (keyNeedsMove) await updateKey(key.id, { name: key.name, key_type: key.key_type, tags: key.tags, folder_id: key.folder_id, vault_id: vaultId });
          await updateIdentity(identity.id, {
            name: identity.name, username: identity.username,
            key_id: identity.key_id, tags: identity.tags, folder_id: identity.folder_id, vault_id: vaultId,
          });
        } catch (err) { setError(String(err)); }
      },
    });
  };

  const handleCopyIdentityToVault = (identity: Identity, vaultId: string) => {
    const key = identity.key_id ? keys.find((k) => k.id === identity.key_id) : undefined;
    const keyNeedsCopy = key && (key.vault_id ?? "personal") !== vaultId;
    const targetVaultName = vaultOptions.find((v) => v.id === vaultId)?.name ?? vaultId;

    requestCascade({
      operation: "copy",
      targetVaultName,
      // "Unnamed key" default name kept in English until all creation sites are localized together (see i18n issue #14)
      items: keyNeedsCopy ? [{ type: "key" as const, label: key.name ?? "Unnamed key" }] : [],
      execute: async () => {
        try {
          let newKeyId = identity.key_id;

          if (keyNeedsCopy) {
            const newKey = await saveKey({ name: key.name, key_type: key.key_type, tags: key.tags, vault_id: vaultId });
            const [priv, pub] = await Promise.all([
              getSecret(`key:${key.id}:private`).catch(() => null),
              getSecret(`key:${key.id}:public`).catch(() => null),
            ]);
            if (priv) await storeSecret(`key:${newKey.id}:private`, priv);
            if (pub) await storeSecret(`key:${newKey.id}:public`, pub);
            newKeyId = newKey.id;
          }

          const newIdentity = await saveIdentity({ name: identity.name, username: identity.username, key_id: newKeyId, tags: identity.tags, vault_id: vaultId });
          const pwd = await getSecret(`identity:${identity.id}:password`).catch(() => null);
          if (pwd) await storeSecret(`identity:${newIdentity.id}:password`, pwd);
        } catch (err) { setError(String(err)); }
      },
    });
  };

  // ── Folder vault move / copy ──────────────────────────────────────────────

  /** All folders in the subtree rooted at folderId (BFS-ordered, parents before children). */
  const getAllSubFolders = (folderId: string): Folder[] => {
    const queue = [folderId];
    const result: Folder[] = [];
    // A parent cycle in the data would otherwise spin forever and lock the renderer.
    const seen = new Set<string>([folderId]);
    while (queue.length) {
      const cur = queue.shift()!;
      const children = scopedFolders.filter((f) => f.parent_folder_id === cur && !seen.has(f.id));
      for (const child of children) seen.add(child.id);
      result.push(...children);
      queue.push(...children.map((f) => f.id));
    }
    return result;
  };

  const folderTreeIds = (folderId: string): Set<string> =>
    new Set([folderId, ...getAllSubFolders(folderId).map((f) => f.id)]);

  /** Keys nested anywhere under folderId. */
  const keysInFolderTree = (folderId: string): SshKey[] => {
    const ids = folderTreeIds(folderId);
    return keys.filter((k) => k.folder_id != null && ids.has(k.folder_id));
  };

  /** Identities nested anywhere under folderId. */
  const identitiesInFolderTree = (folderId: string): Identity[] => {
    const ids = folderTreeIds(folderId);
    return identities.filter((i) => i.folder_id != null && ids.has(i.folder_id));
  };

  /** Keys and identities nested anywhere under folderId. */
  const getItemsInFolderTree = (folderId: string): string[] => [
    ...keysInFolderTree(folderId).map((k) => k.id),
    ...identitiesInFolderTree(folderId).map((i) => i.id),
  ];

  /** Warns about the cascade: subfolders and every key/identity under them go too. */
  const folderDeleteMessage = (folderId: string): string => {
    const count = getItemsInFolderTree(folderId).length;
    return count === 0
      ? t("keychain.page.confirmDeleteFolder.messageEmpty")
      : t("keychain.page.confirmDeleteFolder.message", { count });
  };

  /** A selection that includes folders drags their contents down with it. */
  const bulkDeleteMessage = (ids: string[]): string => {
    const base = t("keychain.page.confirmDelete.message", { count: ids.length });
    const nested = new Set(
      ids.filter((id) => scopedFolders.some((f) => f.id === id)).flatMap(getItemsInFolderTree),
    );
    for (const id of ids) nested.delete(id);
    return nested.size === 0
      ? base
      : `${base} ${t("keychain.page.confirmDelete.folderCascade", { count: nested.size })}`;
  };

  const handleMoveFolderToVault = (folder: Folder, vaultId: string) => {
    const subFolders = getAllSubFolders(folder.id);
    const treeKeys = keysInFolderTree(folder.id);
    const treeIdentities = identitiesInFolderTree(folder.id);
    const targetVaultName = vaultOptions.find((v) => v.id === vaultId)?.name ?? vaultId;

    requestCascade({
      operation: "move",
      targetVaultName,
      description: t("keychain.page.vaultCascade.moveDescription", { folderName: folder.name, targetVaultName }),
      // "Unnamed key" default name kept in English until all creation sites are localized together (see i18n issue #14)
      items: [
        ...treeKeys.map((k) => ({ type: "key" as const, label: k.name ?? "Unnamed key" })),
        ...treeIdentities.map((i) => ({ type: "identity" as const, label: i.name || i.username })),
      ],
      execute: async () => {
        try {
          await updateFolder(folder.id, { name: folder.name, object_type: folder.object_type, parent_folder_id: folder.parent_folder_id, vault_id: vaultId });
          for (const sf of subFolders) {
            await updateFolder(sf.id, { name: sf.name, object_type: sf.object_type, parent_folder_id: sf.parent_folder_id, vault_id: vaultId });
          }
          for (const key of treeKeys) {
            await updateKey(key.id, { name: key.name, key_type: key.key_type, tags: key.tags, folder_id: key.folder_id, vault_id: vaultId });
          }
          for (const identity of treeIdentities) {
            await useIdentityStore.getState().updateIdentity(identity.id, { name: identity.name, username: identity.username, key_id: identity.key_id, tags: identity.tags, folder_id: identity.folder_id, vault_id: vaultId });
          }
        } catch (err) { setError(String(err)); }
      },
    });
  };

  const handleCopyFolderToVault = (folder: Folder, vaultId: string) => {
    const subFolders = getAllSubFolders(folder.id);
    const treeKeys = keysInFolderTree(folder.id);
    const treeIdentities = identitiesInFolderTree(folder.id);
    const targetVaultName = vaultOptions.find((v) => v.id === vaultId)?.name ?? vaultId;

    requestCascade({
      operation: "copy",
      targetVaultName,
      description: t("keychain.page.vaultCascade.copyDescription", { folderName: folder.name, targetVaultName }),
      // "Unnamed key" default name kept in English until all creation sites are localized together (see i18n issue #14)
      items: [
        ...treeKeys.map((k) => ({ type: "key" as const, label: k.name ?? "Unnamed key" })),
        ...treeIdentities.map((i) => ({ type: "identity" as const, label: i.name || i.username })),
      ],
      execute: async () => {
        try {
          const folderIdMap = new Map<string, string>();
          const destHasName = folders.some((f) => (f.vault_id ?? "personal") === vaultId && f.object_type === folder.object_type && f.name === folder.name);
          const newRoot = await saveFolder({ name: destHasName ? `${folder.name} (copy)` : folder.name, object_type: folder.object_type, parent_folder_id: folder.parent_folder_id, vault_id: vaultId });
          folderIdMap.set(folder.id, newRoot.id);
          for (const sf of subFolders) {
            const newParentId = sf.parent_folder_id ? (folderIdMap.get(sf.parent_folder_id) ?? newRoot.id) : newRoot.id;
            const newSf = await saveFolder({ name: sf.name, object_type: sf.object_type, parent_folder_id: newParentId, vault_id: vaultId });
            folderIdMap.set(sf.id, newSf.id);
          }
          const keyIdMap = new Map<string, string>();
          for (const key of treeKeys) {
            const newKey = await useKeyStore.getState().saveKey({ name: key.name, key_type: key.key_type, tags: key.tags, vault_id: vaultId });
            const [priv, pub] = await Promise.all([
              getSecret(`key:${key.id}:private`).catch(() => null),
              getSecret(`key:${key.id}:public`).catch(() => null),
            ]);
            if (priv) await storeSecret(`key:${newKey.id}:private`, priv);
            if (pub) await storeSecret(`key:${newKey.id}:public`, pub);
            keyIdMap.set(key.id, newKey.id);
          }
          for (const identity of treeIdentities) {
            const newKeyId = identity.key_id ? (keyIdMap.get(identity.key_id) ?? identity.key_id) : undefined;
            const newIdentity = await useIdentityStore.getState().saveIdentity({ name: identity.name, username: identity.username, key_id: newKeyId, tags: identity.tags, vault_id: vaultId });
            const pwd = await getSecret(`identity:${identity.id}:password`).catch(() => null);
            if (pwd) await storeSecret(`identity:${newIdentity.id}:password`, pwd);
          }
        } catch (err) { setError(String(err)); }
      },
    });
  };

  // ── Clipboard paste helpers ───────────────────────────────────────────────

  /**
   * Re-publishes a key's material for the vault it now lives in. Without this a key
   * pasted into a team vault reaches every teammate as an object with no private key
   * behind it, and nothing reports why. `saveTeamVaultSecretForVault` no-ops for a
   * personal vault, which is the correct behaviour on the way back out.
   */
  const publishKeySecrets = async (keyId: string, vaultId: string) => {
    for (const part of ["private", "public", "passphrase"]) {
      const localKey = `key:${keyId}:${part}`;
      const value = await getSecret(localKey).catch(() => null);
      if (value) await saveTeamVaultSecretForVault(vaultId, localKey, value).catch(() => {});
    }
  };

  const publishIdentitySecrets = async (identityId: string, vaultId: string) => {
    const localKey = `identity:${identityId}:password`;
    const value = await getSecret(localKey).catch(() => null);
    if (value) await saveTeamVaultSecretForVault(vaultId, localKey, value).catch(() => {});
  };

  /**
   * Duplicates `key` into `folderId`, optionally into another vault. `keepName` is
   * for members of a subtree being cloned wholesale — only the root of such a clone
   * carries the "(copy)" suffix. Throws; callers surface the error.
   */
  const duplicateKeyInto = async (
    key: SshKey,
    folderId: string | null,
    opts: { vaultId?: string; keepName?: boolean } = {},
  ) => {
    const vaultId = opts.vaultId ?? key.vault_id ?? "personal";
    const newKey = await saveKey({
      // default name kept in English until all creation sites are localized together (see i18n issue #14)
      name: key.name ? (opts.keepName ? key.name : `${key.name} (copy)`) : undefined,
      key_type: key.key_type,
      tags: [...key.tags],
      folder_id: folderId ?? undefined,
      vault_id: vaultId,
    });
    for (const part of ["private", "public", "passphrase"]) {
      const value = await getSecret(`key:${key.id}:${part}`).catch(() => null);
      if (!value) continue;
      const localKey = `key:${newKey.id}:${part}`;
      await storeSecret(localKey, value);
      await saveTeamVaultSecretForVault(vaultId, localKey, value).catch(() => {});
    }
    return newKey;
  };

  /** `keyId` overrides the link when the referenced key was cloned alongside it. */
  const duplicateIdentityInto = async (
    identity: Identity,
    folderId: string | null,
    opts: { vaultId?: string; keepName?: boolean; keyId?: string } = {},
  ) => {
    const vaultId = opts.vaultId ?? identity.vault_id ?? "personal";
    const newIdentity = await saveIdentity({
      // default name kept in English until all creation sites are localized together (see i18n issue #14)
      name: identity.name ? (opts.keepName ? identity.name : `${identity.name} (copy)`) : undefined,
      username: identity.username,
      key_id: opts.keyId ?? identity.key_id,
      tags: [...identity.tags],
      folder_id: folderId ?? undefined,
      vault_id: vaultId,
    });
    const pwd = await getSecret(`identity:${identity.id}:password`).catch(() => null);
    if (pwd) {
      const localKey = `identity:${newIdentity.id}:password`;
      await storeSecret(localKey, pwd);
      await saveTeamVaultSecretForVault(vaultId, localKey, pwd).catch(() => {});
    }
    return newIdentity;
  };

  /** Deep-clones a folder subtree under `parentFolderId`, into `vaultId` when given. */
  const copyFolderInto = async (
    folderId: string,
    parentFolderId: string | null,
    vaultId?: string,
  ) => {
    const folder = scopedFolders.find((f) => f.id === folderId);
    if (!folder) throw new Error(`Unknown folder ${folderId}`);
    const targetVaultId = vaultId ?? folder.vault_id;
    // Only the root of the clone is renamed; renaming every descendant would
    // compound to "Prod (copy) (copy)" on a second paste.
    // default name kept in English until all creation sites are localized together (see i18n issue #14)
    const root = await saveFolder({
      name: `${folder.name} (copy)`,
      object_type: folder.object_type,
      parent_folder_id: parentFolderId ?? undefined,
      vault_id: targetVaultId,
    });
    // BFS order guarantees a parent is created before its children.
    const folderIdMap = new Map<string, string>([[folder.id, root.id]]);
    for (const sf of getAllSubFolders(folder.id)) {
      const created = await saveFolder({
        name: sf.name,
        object_type: sf.object_type,
        parent_folder_id: folderIdMap.get(sf.parent_folder_id ?? "") ?? root.id,
        vault_id: targetVaultId,
      });
      folderIdMap.set(sf.id, created.id);
    }
    // Keys first: an identity cloned from the same subtree must point at the clone
    // of its key, not at the original.
    const keyIdMap = new Map<string, string>();
    for (const key of keysInFolderTree(folder.id)) {
      const created = await duplicateKeyInto(key, folderIdMap.get(key.folder_id ?? "") ?? root.id, {
        vaultId: targetVaultId,
        keepName: true,
      });
      keyIdMap.set(key.id, created.id);
    }
    for (const identity of identitiesInFolderTree(folder.id)) {
      await duplicateIdentityInto(identity, folderIdMap.get(identity.folder_id ?? "") ?? root.id, {
        vaultId: targetVaultId,
        keepName: true,
        keyId: identity.key_id ? (keyIdMap.get(identity.key_id) ?? identity.key_id) : undefined,
      });
    }
    return root;
  };

  /**
   * Moves a folder subtree into `vaultId`, reparenting the root at the same time.
   * Same updateFolder/updateKey/updateIdentity path handleMoveFolderToVault uses, so
   * the team-vault migration logic in the stores applies.
   */
  const migrateFolderTreeToVault = async (
    folder: Folder,
    parentFolderId: string | null,
    vaultId: string,
  ) => {
    await updateFolder(folder.id, {
      name: folder.name,
      object_type: folder.object_type,
      parent_folder_id: parentFolderId ?? undefined,
      vault_id: vaultId,
    });
    for (const sf of getAllSubFolders(folder.id)) {
      await updateFolder(sf.id, { name: sf.name, object_type: sf.object_type, parent_folder_id: sf.parent_folder_id, vault_id: vaultId });
    }
    for (const key of keysInFolderTree(folder.id)) {
      await updateKey(key.id, { name: key.name, key_type: key.key_type, tags: key.tags, folder_id: key.folder_id, vault_id: vaultId });
      await publishKeySecrets(key.id, vaultId);
    }
    for (const identity of identitiesInFolderTree(folder.id)) {
      await updateIdentity(identity.id, { name: identity.name, username: identity.username, key_id: identity.key_id, tags: identity.tags, folder_id: identity.folder_id, vault_id: vaultId });
      await publishIdentitySecrets(identity.id, vaultId);
    }
  };

  const openKeyFormRef = useRef(openKeyForm);
  openKeyFormRef.current = openKeyForm;
  const openIdentityFormRef = useRef(openIdentityForm);
  openIdentityFormRef.current = openIdentityForm;

  const handleKeySelect = useCallback((id: string, e: React.MouseEvent<HTMLDivElement>) => {
    handleItemSelect(id, e);
    if (showPanelRef.current) {
      const key = filteredKeysRef.current.find((k) => k.id === id);
      if (key) openKeyFormRef.current(key);
    }
  }, [handleItemSelect]);

  const handleIdentitySelect = useCallback((id: string, e: React.MouseEvent<HTMLDivElement>) => {
    handleItemSelect(id, e);
    if (showPanelRef.current) {
      const identity = filteredIdentitiesRef.current.find((i) => i.id === id);
      if (identity) openIdentityFormRef.current(identity);
    }
  }, [handleItemSelect]);

  return (
    <>
    <SidePanelLayout
      panelOpen={showPanel || editingFolder !== null}
      panelWidth={editingFolder !== null && !showPanel ? 280 : 340}
      panel={
        <>
          {editingFolder !== null && !showPanel && (
            <FolderEditPanel
              folder={editingFolder}
              onUpdate={(id, data) => void updateFolder(id, data)}
              onDelete={(f) => setConfirmDeleteFolderId(f.id)}
              onExport={() => useUIStore.getState().openImportExport("export", { bulk: { keys: keys.filter((k) => k.folder_id === editingFolder.id).map((k) => k.id), identities: identities.filter((i) => i.folder_id === editingFolder.id).map((i) => i.id) } })}
              onClose={() => setEditingFolderId(null)}
              vaults={vaultOptions.filter((v) => v.id !== (editingFolder.vault_id ?? "personal"))}
              canEdit={can("EDIT_KEYS", editingFolder.vault_id ?? "personal")}
              onMoveToVault={(vaultId) => handleMoveFolderToVault(editingFolder, vaultId)}
              onCopyToVault={(vaultId) => handleCopyFolderToVault(editingFolder, vaultId)}
            />
          )}
          {exportingKey && (
            <KeyExportPanel
              sshKey={exportingKey}
              onClose={closePanel}
            />
          )}
          {showKeyForm && (
            <KeyForm
              key={`${keyFormSessionKeyRef.current}-${keyFormVersion}`}
              initial={editingKey ?? undefined}
              initialMode={keyFormMode}
              onSubmit={handleKeySubmit}
              onClose={closePanel}
              onExport={openExportPanel}
              onDelete={editingKey ? handleDeleteKey : undefined}
              flushRef={keyFormFlushRef}
              isDirtyRef={keyFormIsDirtyRef}
              vaults={editingKey ? vaultOptions.filter((v) => v.id !== (editingKey.vault_id ?? "personal")) : []}
              canEdit={editingKey ? can("EDIT_KEYS", editingKey.vault_id ?? "personal") : false}
              onMoveToVault={editingKey ? (vaultId) => { void handleMoveKeyToVault(editingKey, vaultId); } : undefined}
              onCopyToVault={editingKey ? (vaultId) => { void handleCopyKeyToVault(editingKey, vaultId); } : undefined}
            />
          )}
          {showIdentityForm && (
            <IdentityForm
              key={`${identityFormSessionKeyRef.current}-${identityFormVersion}`}
              initial={editingIdentity ?? undefined}
              onSubmit={handleIdentitySubmit}
              onClose={closePanel}
              onDelete={editingIdentity ? handleDeleteIdentity : undefined}
              flushRef={identityFormFlushRef}
              isDirtyRef={identityFormIsDirtyRef}
              vaults={editingIdentity ? vaultOptions.filter((v) => v.id !== (editingIdentity.vault_id ?? "personal")) : []}
              canEdit={editingIdentity ? can("EDIT_IDENTITIES", editingIdentity.vault_id ?? "personal") : false}
              onMoveToVault={editingIdentity ? (vaultId) => { void handleMoveIdentityToVault(editingIdentity, vaultId); } : undefined}
              onCopyToVault={editingIdentity ? (vaultId) => { void handleCopyIdentityToVault(editingIdentity, vaultId); } : undefined}
            />
          )}
        </>
      }
    >
      <KeychainToolbar
          search={search}
          onSearchChange={setSearch}
          layoutMode={layoutMode}
          onLayoutModeChange={setLayoutMode}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          onImportKey={canEditKeys ? () => openKeyForm(null) : undefined}
          onGenerateKey={canEditKeys ? openKeyGenForm : undefined}
          onNewIdentity={canEditIdentities ? () => openIdentityForm(null) : undefined}
          onNewFolder={() => void saveFolder({ name: "New Folder" /* persisted English default; menu label is localized */, object_type: "keychain", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId })}
          availableTags={availableTags}
          tagFilter={tagFilter}
          onTagFilterChange={setTagFilter}
        />

        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

        <DragSelectSurface
          selectionAreaRef={selectionAreaRef}
          onMouseDown={handleSelectionAreaMouseDown}
          dragBox={dragBox}
          className="flex-1 overflow-y-auto px-9 pt-5 pb-9"
          onClick={() => {
            if (!showPanel && !editingFolder) return;
            keyFormFlushRef.current?.();
            identityFormFlushRef.current?.();
            closePanel();
            setEditingFolderId(null);
          }}
          onContextMenu={(e) => {
            if ((e.target as Element).closest("[data-card]")) return;
            setSelection([]);
            openBgMenu(e);
          }}
        >
          <div ref={itemAreaRef} data-drag-surface="true" className="space-y-6">

            {/* ── Folder breadcrumb ── */}
            {folderPath.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  className="flex items-center gap-1.5 text-xs transition-colors text-(--t-text-dim) hover:text-(--t-text-primary)"
                  onClick={navigateToRoot}
                >
                  <Icon icon="lucide:chevron-left" width={13} />
                  {t("keychain.page.all")}
                </button>
                {folderPath.map((folder, i) => (
                  <span key={folder.id} className="flex items-center gap-2">
                    <span className="text-(--t-text-dim)">/</span>
                    {i < folderPath.length - 1 ? (
                      <button
                        className="text-xs transition-colors text-(--t-text-dim) hover:text-(--t-text-primary)"
                        onClick={() => navigateTo(i)}
                      >
                        {folder.name}
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-(--t-text-primary)">
                        {folder.name}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* ── Folders section ── */}
            {visibleFolders.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
                    {t("keychain.page.folders")}
                  </p>
                  <button
                    className="flex items-center gap-1 text-xs transition-colors px-2 py-1 rounded-lg text-(--t-text-dim)"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--t-text-primary)";
                      e.currentTarget.style.background = "var(--t-bg-elevated)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--t-text-dim)";
                      e.currentTarget.style.background = "transparent";
                    }}
                    onClick={() => void saveFolder({ name: "New Folder" /* persisted English default */, object_type: "keychain", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId })}
                  >
                    <Icon icon="lucide:plus" width={12} />
                    {t("keychain.page.new")}
                  </button>
                </div>
                <div
                  className={layoutMode === "grid" ? "grid gap-4" : "flex flex-col gap-1"}
                  style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" } : undefined}
                >
                  {visibleFolders.map((folder) => (
                    <FolderCard
                      key={folder.id}
                      folder={folder}
                      itemCount={folderCounts[folder.id] ?? 0}
                      layout={layoutMode}
                      isSelected={editingFolderId === folder.id || selectedIdSet.has(folder.id)}
                      isFocused={focusedId === folder.id}
                      isDragOver={dragOverFolderId === folder.id}
                      dimmed={cutIds.has(folder.id)}
                      onClick={() => navigateInto(folder)}
                      onRename={(f, newName) => void updateFolder(f.id, { name: newName, object_type: f.object_type, parent_folder_id: f.parent_folder_id })}
                      onDelete={(f) => setConfirmDeleteFolderId(f.id)}
                      onSelect={(id) => { if (!selectedIdSet.has(id)) selectSingle(id); }}
                      onEdit={() => { closePanel(); setEditingFolderId(folder.id); }}
                      onExport={() => useUIStore.getState().openImportExport("export", { bulk: { keys: keys.filter((k) => k.folder_id === folder.id).map((k) => k.id), identities: identities.filter((i) => i.folder_id === folder.id).map((i) => i.id) } })}
                      onPointerDown={(e) => handleFolderDragStart(e, folder.id)}
                      {...folderDropProps(folder.id)}
                      vaults={vaultOptions.filter((v) => v.id !== (folder.vault_id ?? "personal"))}
                      canEdit={can("EDIT_KEYS", folder.vault_id ?? "personal")}
                      onMoveToVault={(vaultId) => handleMoveFolderToVault(folder, vaultId)}
                      onCopyToVault={(vaultId) => handleCopyFolderToVault(folder, vaultId)}
                      bulkContextMenuItems={selectedIdSet.size > 1 ? bulkContextMenuItems : undefined}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Eject drop zone (in DOM whenever inside folder, visible only while dragging) ── */}
            {activeFolderId && (
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-150"
                style={{
                  border: dragOverEject ? "2px solid var(--t-accent)" : "2px dashed var(--t-border-hover)",
                  background: dragOverEject
                    ? "color-mix(in srgb, var(--t-accent) 8%, var(--t-bg-card))"
                    : "transparent",
                  color: dragOverEject ? "var(--t-accent)" : "var(--t-text-dim)",
                  opacity: isDragging ? 1 : 0,
                  pointerEvents: isDragging ? "auto" : "none",
                  height: isDragging ? undefined : 0,
                  padding: isDragging ? undefined : 0,
                  marginTop: isDragging ? undefined : 0,
                  overflow: "hidden",
                }}
                {...ejectDropProps(ejectTargetFolderId)}
              >
                <Icon icon="lucide:folder-minus" width={16} />
                <span className="text-sm font-medium">
                  {ejectTargetFolderId
                    ? t("keychain.page.ejectMoveTo", { name: folderPath[folderPath.length - 2].name })
                    : t("keychain.page.ejectRemoveFromFolder")}
                </span>
              </div>
            )}

            {(pinnedKeys.length > 0 || pinnedIdentities.length > 0) && (
              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">{t("keychain.page.pinned")}</p>
                {pinnedKeys.length > 0 && (
                  <KeySection
                    keys={pinnedKeys}
                    label={t("keychain.cards.sshKeysLabel")}
                    showDraft={false}
                    editingId={editingKey?.id ?? null}
                    selectedIdSet={selectedIdSet}
                    layoutMode={layoutMode}
                    focusedId={focusedId}
                    dimmedIds={cutIds}
                    onEdit={openKeyForm}
                    onDelete={handleDeleteKey}
                    onSelect={handleKeySelect}
                    onExport={openExportPanel}
                    bulkContextMenuItems={bulkContextMenuItems}
                    onPointerDown={handleDragStart}
                    vaultOptions={vaultOptions}
                    onMoveToVault={handleMoveKeyToVault}
                    onCopyToVault={handleCopyKeyToVault}
                  />
                )}
                {pinnedIdentities.length > 0 && (
                  <IdentitySection
                    identities={pinnedIdentities}
                    keys={keys}
                    label={t("keychain.cards.identitiesLabel")}
                    layoutMode={layoutMode}
                    showDraft={false}
                    editingId={editingIdentity?.id ?? null}
                    selectedIdSet={selectedIdSet}
                    focusedId={focusedId}
                    dimmedIds={cutIds}
                    onEdit={openIdentityForm}
                    onDelete={handleDeleteIdentity}
                    onSelect={handleIdentitySelect}
                    bulkContextMenuItems={bulkContextMenuItems}
                    onPointerDown={handleDragStart}
                    vaultOptions={vaultOptions}
                    onMoveToVault={handleMoveIdentityToVault}
                    onCopyToVault={handleCopyIdentityToVault}
                  />
                )}
              </div>
            )}

            <KeySection
              keys={filteredKeys}
              showDraft={showKeyForm && !editingKey}
              editingId={editingKey?.id ?? null}
              selectedIdSet={selectedIdSet}
              layoutMode={layoutMode}
              focusedId={focusedId}
              dimmedIds={cutIds}
              onAdd={canEditKeys ? () => openKeyForm(null) : undefined}
              onEdit={openKeyForm}
              onDelete={handleDeleteKey}
              onSelect={handleKeySelect}
              onExport={openExportPanel}
              bulkContextMenuItems={bulkContextMenuItems}
              onPointerDown={handleDragStart}
              vaultOptions={vaultOptions}
              onMoveToVault={handleMoveKeyToVault}
              onCopyToVault={handleCopyKeyToVault}
            />

            <IdentitySection
              identities={filteredIdentities}
              keys={keys}
              layoutMode={layoutMode}
              showDraft={showIdentityForm && !editingIdentity}
              editingId={editingIdentity?.id ?? null}
              selectedIdSet={selectedIdSet}
              focusedId={focusedId}
              dimmedIds={cutIds}
              onAdd={canEditIdentities ? () => openIdentityForm(null) : undefined}
              onEdit={openIdentityForm}
              onDelete={handleDeleteIdentity}
              onSelect={handleIdentitySelect}
              bulkContextMenuItems={bulkContextMenuItems}
              onPointerDown={handleDragStart}
              vaultOptions={vaultOptions}
              onMoveToVault={handleMoveIdentityToVault}
              onCopyToVault={handleCopyIdentityToVault}
            />
          </div>
        </DragSelectSurface>

      {bgMenuPos && (
        <ContextMenu
          pos={bgMenuPos}
          onClose={closeBgMenu}
          items={[
            ...(canEditKeys ? [
              { label: t("keychain.toolbar.newKey"), icon: "lucide:key-round", onClick: () => openKeyForm(null) },
              { label: t("keychain.toolbar.generateKeyPair"), icon: "lucide:sparkles", onClick: openKeyGenForm },
            ] : []),
            ...(canEditIdentities ? [
              { label: t("keychain.toolbar.newIdentity"), icon: "lucide:user-plus", onClick: () => openIdentityForm(null) },
            ] : []),
            { label: t("keychain.toolbar.newFolder"), icon: "lucide:folder-plus", onClick: () => void saveFolder({ name: "New Folder" /* persisted English default */, object_type: "keychain", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }) },
            ...(useVaultClipboardStore.getState().clipboard?.tab === "keychain"
              ? [{ label: t("common.action.paste"), icon: "lucide:clipboard", shortcut: getShortcutHint("paste"), onClick: () => window.dispatchEvent(new CustomEvent("voltius:clipboard-paste")) } as const]
              : []),
            ...bgContributions,
          ]}
        />
      )}

      {confirmDeleteFolderId && (
        <ConfirmModal
          title={t("keychain.page.confirmDeleteFolder.title")}
          message={folderDeleteMessage(confirmDeleteFolderId)}
          confirmLabel={t("common.action.delete")}
          onConfirm={() => {
            void deleteFolder(confirmDeleteFolderId);
            onFolderDeleted(confirmDeleteFolderId);
            if (editingFolder?.id === confirmDeleteFolderId) setEditingFolderId(null);
            setConfirmDeleteFolderId(null);
          }}
          onCancel={() => setConfirmDeleteFolderId(null)}
        />
      )}

      {confirmDeleteIds && (
        <ConfirmModal
          title={t("keychain.page.confirmDelete.title", { count: confirmDeleteIds.length })}
          message={bulkDeleteMessage(confirmDeleteIds)}
          confirmLabel={t("common.action.delete")}
          onConfirm={async () => {
            for (const id of confirmDeleteIds) {
              if (selectedKeyIds.includes(id)) await handleDeleteKey(id);
              else if (selectedIdentityIds.includes(id)) await handleDeleteIdentity(id);
              else if (scopedFolders.some((f) => f.id === id)) await deleteFolder(id);
            }
            setSelection([]);
            setConfirmDeleteIds(null);
          }}
          onCancel={() => setConfirmDeleteIds(null)}
        />
      )}

    </SidePanelLayout>

      {crossVaultPaste.pending && (
        <VaultCascadeModal
          cascade={crossVaultPaste.pending}
          onConfirm={crossVaultPaste.accept}
          onCancel={crossVaultPaste.cancel}
        />
      )}

      {cascadePending && (
        <VaultCascadeModal
          cascade={cascadePending}
          onConfirm={() => { void confirmCascade(); }}
          onCancel={cancelCascade}
        />
      )}

      <ClipboardPill navItem="keychain" />
    </>
  );
}
