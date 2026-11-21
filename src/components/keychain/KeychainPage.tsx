import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cardGridProps } from "@/components/shared/cardGrid";
import { SectionAddButton, SectionHeader } from "@/components/shared/SectionHeader";
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
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { usePermissions } from "@/hooks/usePermission";
import { useCloseWhenGone } from "@/hooks/useCloseWhenGone";
import { useVaultStore } from "@/stores/vaultStore";
import { useAccessibleVaultIds, useScopedVaultId } from "@/hooks/useAccessibleVaultIds";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { usePageBulkActions } from "@/hooks/usePageBulkActions";
import { useDragToFolder } from "@/hooks/useDragToFolder";
import { folderDragHandlers } from "@/utils/folderDragHandlers";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { useNewFolder } from "@/hooks/useNewFolder";
import { useFolderStore } from "@/stores/folderStore";
import { useAllIdentities } from "@/hooks/useAllIdentities";
import { useAllKeys } from "@/hooks/useAllKeys";
import { useAllFolders } from "@/hooks/useAllFolders";
import { FolderCard } from "@/components/folders/FolderCard";
import { FolderEditPanel } from "@/components/folders/FolderEditPanel";
import { FolderEmptyState } from "@/components/folders/FolderEmptyState";
import { KeychainToolbar } from "./KeychainToolbar";
import { KeySection, IdentitySection } from "./KeyCards";
import { KeyForm } from "./KeyForm";
import { IdentityForm } from "./IdentityForm";
import { KeyExportPanel, sortByMode } from "./KeyExportPanel";
import { saveIdentityFromForm, saveKeyFromForm } from "@/services/keychainForm";
import type { Folder, Identity, IdentityFormData, SshKey, SshKeyFormData } from "@/types";
import { SidePanelLayout } from "@/components/shared/SidePanelLayout";
import { useSyncedFormKey } from "@/hooks/useSyncedFormKey";
import { buildTeamVaultTransferPlan, type TransferOperation } from "@/services/teamVaultPermissions";
import { useVaultObjectsClipboard } from "@/hooks/useVaultObjectsClipboard";
import { useCrossVaultPasteConfirm } from "@/hooks/useCrossVaultPasteConfirm";
import { ClipboardPill } from "@/components/shared/ClipboardPill";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import { getShortcutHint } from "@/stores/shortcutStore";
import { clipboardMenuItems } from "@/utils/clipboardMenuItems";
import { foldersOutsideSubtree, itemsInFolderSubtree, folderItemCounter } from "@/utils/folderTree";
import { folderAwareKeys, selectFollowing } from "@/utils/cardInteraction";
import { folderDeleteMessages } from "@/utils/folderDeleteMessages";
import { useVaultOptions } from "@/hooks/useVaultOptions";
import { useScopedFolders } from "@/hooks/useScopedFolders";
import { FolderBreadcrumb } from "@/components/folders/FolderBreadcrumb";
import { FolderEjectZone } from "@/components/folders/FolderEjectZone";
import { useSearchMatcher } from "@/utils/search";
import { passMoveCancelled } from "@/services/teamObjectPersistence";
import { describeError } from "@/services/backendErrors";
import { folderTarget, identityTarget, keyTarget, refuseWhilePreviewing, whenWritable } from "@/services/previewGuard";
import { TeamVaultNotes } from "@/components/shared/VaultUnavailableNote";

export default function KeychainPage() {
  const { t } = useTranslation();
  const { loadIdentities, deleteIdentity } = useIdentityStore();
  const identities = useAllIdentities();
  const { loadKeys, deleteKey } = useKeyStore();
  const keys = useAllKeys();
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
  const reportSaveError = passMoveCancelled(setError);
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
  const accessibleVaultIds = useAccessibleVaultIds();
  const scopedVaultId = useScopedVaultId();
  const can = usePermissions();
  const canEditKeys = selectedVaultIds.some((vid) => can("EDIT_KEYS", vid));
  const canEditIdentities = selectedVaultIds.some((vid) => can("EDIT_IDENTITIES", vid));

  const vaultOptions = useVaultOptions();
  const q = search.trim();
  const match = useSearchMatcher(q);
  const scopedFolders = useScopedFolders(folders, accessibleVaultIds, "keychain");
  // Every vault's, not only those on screen: the clipboard outlives a vault switch.
  const keychainFolders = useMemo(() => folders.filter((f) => f.object_type === "keychain"), [folders]);
  const scopedFolderIds = useMemo(() => new Set(scopedFolders.map((f) => f.id)), [scopedFolders]);
  const editingFolder = editingFolderId ? scopedFolders.find((f) => f.id === editingFolderId) ?? null : null;
  useCloseWhenGone(editingKeyId, editingKey !== null, () => closePanel());
  useCloseWhenGone(editingIdentityId, editingIdentity !== null, () => closePanel());
  useCloseWhenGone(exportingKey?.id, !!exportingKey && keys.some((k) => k.id === exportingKey.id), () => closePanel());
  useCloseWhenGone(editingFolderId, editingFolder !== null, () => setEditingFolderId(null));

  const {
    folderPath,
    activeFolderId,
    ejectTargetFolderId,
    visibleFolders,
    navigateInto,
    navigateTo,
    navigateToRoot,
    onFolderDeleted,
  } = useFolderNavigation(scopedFolders, "keychain");
  const { folderBlocked, addFolder } = useNewFolder("keychain", folderPath, saveFolder);

  const availableTags = useMemo(
    () => [...new Set([...keys.flatMap((k) => k.tags), ...identities.flatMap((i) => i.tags)])].sort(),
    [keys, identities],
  );

  const filteredKeys = useMemo(() =>
    sortByMode(keys.filter((k) => {
      const kvid = k.vault_id ?? "personal";
      if (accessibleVaultIds.length > 0 && !accessibleVaultIds.includes(kvid)) return false;
      if (!match(k.name, k.key_type)) return false;
      if (tagFilter.length > 0 && !tagFilter.some((t) => k.tags.includes(t))) return false;
      if (activeFolderId) return k.folder_id === activeFolderId;
      return scopedFolders.length === 0 || !k.folder_id || !scopedFolderIds.has(k.folder_id);
    }), sortMode),
    [keys, match, sortMode, tagFilter, activeFolderId, scopedFolders, scopedFolderIds, accessibleVaultIds],
  );
  const filteredIdentities = useMemo(() =>
    sortByMode(
      identities.filter((i) => {
        const ivid = i.vault_id ?? "personal";
        if (accessibleVaultIds.length > 0 && !accessibleVaultIds.includes(ivid)) return false;
        if (!match(i.name, i.username)) return false;
        if (tagFilter.length > 0 && !tagFilter.some((t) => i.tags.includes(t))) return false;
        if (activeFolderId) return i.folder_id === activeFolderId;
        return scopedFolders.length === 0 || !i.folder_id || !scopedFolderIds.has(i.folder_id);
      }),
      sortMode,
    ),
    [identities, match, sortMode, tagFilter, activeFolderId, scopedFolders, scopedFolderIds, accessibleVaultIds],
  );

  const showPanel = showKeyForm || showIdentityForm || exportingKey !== null;

  // Refs for stable onSelect callbacks (avoid re-creating per render)
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

  const editItem = (id: string) => {
    const key = keys.find((k) => k.id === id);
    if (key) { openKeyFormRef.current(key); return; }
    const identity = identities.find((i) => i.id === id);
    if (identity) openIdentityFormRef.current(identity);
  };

  const { focusedId, setFocusedId } = useListKeyNav({
    orderedIds,
    selectedIdSet,
    selectSingle,
    setSelection,
    itemAreaRef,
    layoutMode,
    ...folderAwareKeys(visibleFolders, { open: navigateInto, edit: (f) => editFolderRef.current(f) }, { enter: editItem, edit: editItem }),
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
    ...folderDragHandlers({
      moveItems: dropHandler,
      moveFolders: async (folderDragIds, targetParentId) => {
        for (const id of folderDragIds) await moveFolder(id, targetParentId);
        await loadFolders();
      },
      onError: setError,
    }),
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
        can,
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
        onClick: () => transferToVault(
          [...selectedFolders, ...selectedKeys, ...selectedIdentities].map((o) => o.id),
          v.id,
          operation === "move" ? "cut" : "copy",
        ),
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
          ? t("common.objectSync.disableCount", { count: allIds.length })
          : t("common.objectSync.enableCount", { count: allIds.length }),
        icon: allSynced ? "lucide:cloud-off" : "lucide:cloud",
        onClick: () => useSyncPrefsStore.getState().setObjectsSynced(
          allIds.map((id) => ({ id, typeId: selectedKeyIds.includes(id) ? "key" : "identity" })),
          !allSynced,
        ),
      },
    ];
    if (selectedKeyIds.length > 0) {
      items.push({
        label: t("keychain.page.bulk.exportPublicKeys", { count: selectedKeyIds.length }),
        icon: "lucide:upload",
        onClick: () => useUIStore.getState().openImportExport("export", { bulk: { keys: selectedKeyIds, identities: selectedIdentityIds } }),
      });
    }
    items.push(...clipboardMenuItems(t));
    items.push({
      label: t("keychain.page.bulk.deleteItems", { count: allIds.length }),
      icon: "lucide:trash-2",
      onClick: whenWritable(() => setConfirmDeleteIds(allIds)),
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

  const { transferToVault, moveToVault: handleMoveToVault, copyToVault: handleCopyToVault } = useVaultObjectsClipboard("keychain", {
    selectedIdSet,
    focusedId,
    activeFolderId,
    scopedVaultId,
    accessibleVaultIds,
    vaultOptions,
    can,
    confirmCrossVault: crossVaultPaste.confirmCrossVault,
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
      await saveKeyFromForm(
        editingKey, data, privateKey, publicKey, passphrase, selectedVaultIds[0] ?? "personal", (created) => setEditingKeyId(created.id),
      );
    } catch (err) {
      reportSaveError(err);
    }
  };

  const handleIdentitySubmit = async (
    data: IdentityFormData,
    password: string | null,
    inlineKeyMaterial?: { label?: string; privateKey: string; publicKey: string },
  ) => {
    try {
      await saveIdentityFromForm(
        editingIdentity, data, password, inlineKeyMaterial, inlineKeyIdRef, selectedVaultIds[0] ?? "personal",
        (created) => setEditingIdentityId(created.id),
      );
    } catch (err) {
      reportSaveError(err);
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (refuseWhilePreviewing(keyTarget(id))) return;
    try {
      await deleteKey(id);
      if (editingKey?.id === id) { setEditingKeyId(null); setShowKeyForm(false); }
    } catch (err) { setError(describeError(err, t)); }
  };

  const handleDeleteIdentity = async (id: string) => {
    if (refuseWhilePreviewing(identityTarget(id))) return;
    try {
      await deleteIdentity(id);
      if (editingIdentity?.id === id) { setEditingIdentityId(null); setShowIdentityForm(false); }
    } catch (err) { setError(describeError(err, t)); }
  };

  const openKeyForm = (key: SshKey | null, mode: "import" | "generate" = "import") => {
    if (refuseWhilePreviewing(keyTarget(key?.id))) return;
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
    if (refuseWhilePreviewing(identityTarget(identity?.id))) return;
    identityFormIsDirtyRef.current = false;
    identityFormSessionKeyRef.current = identity?.id ?? `new-identity-${Date.now()}`;
    setEditingIdentityId(identity?.id ?? null);
    if (identity) selectSingle(identity.id);
    setShowIdentityForm(true);
    setShowKeyForm(false);
    setEditingKeyId(null);
  };

  const folderCount = useMemo(
    () => folderItemCounter([...keys, ...identities], scopedFolders),
    [keys, identities, scopedFolders],
  );

  const openExportPanel = (key: SshKey) => {
    if (refuseWhilePreviewing(keyTarget(key.id))) return;
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

  // ── Folder vault move / copy ──────────────────────────────────────────────

  /** Keys nested anywhere under folderId. */
  function keysInFolderTree(folderId: string): SshKey[] {
    return itemsInFolderSubtree(keys, keychainFolders, folderId);
  }

  /** Identities nested anywhere under folderId. */
  function identitiesInFolderTree(folderId: string): Identity[] {
    return itemsInFolderSubtree(identities, keychainFolders, folderId);
  }

  /** Keys and identities nested anywhere under folderId. */
  const getItemsInFolderTree = (folderId: string): string[] => [
    ...keysInFolderTree(folderId).map((k) => k.id),
    ...identitiesInFolderTree(folderId).map((i) => i.id),
  ];

  const { folderDeleteMessage, bulkDeleteMessage } = folderDeleteMessages({
    t,
    prefix: "keychain.page",
    folders: scopedFolders,
    itemIdsInFolderTree: getItemsInFolderTree,
  });

  const openKeyFormRef = useRef(openKeyForm);
  openKeyFormRef.current = openKeyForm;
  const openIdentityFormRef = useRef(openIdentityForm);
  openIdentityFormRef.current = openIdentityForm;

  const panelOpenRef = useRef(false);
  panelOpenRef.current = showPanel || editingFolderId !== null;

  const handleKeySelect = useCallback((id: string, e: React.MouseEvent<HTMLDivElement>) =>
    selectFollowing(handleItemSelect, panelOpenRef.current, () => {
      const key = filteredKeysRef.current.find((k) => k.id === id);
      if (key) openKeyFormRef.current(key);
    })(id, e), [handleItemSelect]);

  const handleIdentitySelect = useCallback((id: string, e: React.MouseEvent<HTMLDivElement>) =>
    selectFollowing(handleItemSelect, panelOpenRef.current, () => {
      const identity = filteredIdentitiesRef.current.find((i) => i.id === id);
      if (identity) openIdentityFormRef.current(identity);
    })(id, e), [handleItemSelect]);

  const editFolder = (folder: Folder) => {
    if (refuseWhilePreviewing(folderTarget(folder.id))) return;
    closePanel();
    setEditingFolderId(folder.id);
  };
  const editFolderRef = useRef(editFolder);
  editFolderRef.current = editFolder;

  const createFolder = () => void addFolder(t("keychain.toolbar.newFolder"));

  // Inside a folder only the types it holds are listed; the per-type "none yet" states are for the root.
  const inFolderView = !!activeFolderId && !q;
  const showKeys = !inFolderView || filteredKeys.length > 0 || (showKeyForm && !editingKey);
  const showIdentities = !inFolderView || filteredIdentities.length > 0 || (showIdentityForm && !editingIdentity);

  return (
    <>
    <SidePanelLayout
      panelOpen={showPanel || editingFolder !== null}
      panelWidth={editingFolder !== null && !showPanel ? 320 : 340}
      panel={
        <>
          {editingFolder !== null && !showPanel && (
            <FolderEditPanel
              folder={editingFolder}
              onUpdate={updateFolder}
              onDelete={(f) => setConfirmDeleteFolderId(f.id)}
              onExport={() => useUIStore.getState().openImportExport("export", { bulk: { keys: keys.filter((k) => k.folder_id === editingFolder.id).map((k) => k.id), identities: identities.filter((i) => i.folder_id === editingFolder.id).map((i) => i.id) } })}
              onClose={() => setEditingFolderId(null)}
              onOpen={() => { navigateInto(editingFolder); setEditingFolderId(null); }}
              onSelectSelf={() => selectSingle(editingFolder.id)}
              parentOptions={foldersOutsideSubtree(scopedFolders, editingFolder.id)}
              vaults={vaultOptions.filter((v) => v.id !== (editingFolder.vault_id ?? "personal"))}
              onMoveToVault={(vaultId) => handleMoveToVault(editingFolder, vaultId)}
              onCopyToVault={(vaultId) => handleCopyToVault(editingFolder, vaultId)}
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
              onMoveToVault={editingKey ? (vaultId) => handleMoveToVault(editingKey, vaultId) : undefined}
              onCopyToVault={editingKey ? (vaultId) => handleCopyToVault(editingKey, vaultId) : undefined}
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
              onMoveToVault={editingIdentity ? (vaultId) => handleMoveToVault(editingIdentity, vaultId) : undefined}
              onCopyToVault={editingIdentity ? (vaultId) => handleCopyToVault(editingIdentity, vaultId) : undefined}
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
          onNewFolder={createFolder}
          newFolderBlocked={folderBlocked}
          availableTags={availableTags}
          tagFilter={tagFilter}
          onTagFilterChange={setTagFilter}
        />

        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

        <TeamVaultNotes className="mx-5 mt-3" />

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
            <FolderBreadcrumb
              path={folderPath}
              rootLabel={t("keychain.page.all")}
              onNavigateToRoot={navigateToRoot}
              onNavigateTo={navigateTo}
            />

            {/* ── Folders section ── */}
            {visibleFolders.length > 0 && (
              <div>
                <SectionHeader
                  label={t("keychain.page.folders")}
                  count={visibleFolders.length}
                  aside={<SectionAddButton label={t("keychain.page.new")} onClick={createFolder} disabledReason={folderBlocked} />}
                />
                <div
                  {...cardGridProps(layoutMode, "card")}
                >
                  {visibleFolders.map((folder) => (
                    <FolderCard
                      key={folder.id}
                      folder={folder}
                      itemCount={folderCount(folder.id)}
                      layout={layoutMode}
                      isSelected={editingFolderId === folder.id || selectedIdSet.has(folder.id)}
                      isFocused={focusedId === folder.id}
                      isDragOver={dragOverFolderId === folder.id}
                      dimmed={cutIds.has(folder.id)}
                      onOpen={() => navigateInto(folder)}
                      onRename={(f, newName) => void updateFolder(f.id, { name: newName, object_type: f.object_type, parent_folder_id: f.parent_folder_id })}
                      onDelete={(f) => setConfirmDeleteFolderId(f.id)}
                      onSelect={selectFollowing(handleItemSelect, panelOpenRef.current, () => editFolder(folder))}
                      onEdit={() => editFolder(folder)}
                      onExport={() => useUIStore.getState().openImportExport("export", { bulk: { keys: keys.filter((k) => k.folder_id === folder.id).map((k) => k.id), identities: identities.filter((i) => i.folder_id === folder.id).map((i) => i.id) } })}
                      onPointerDown={(e) => handleFolderDragStart(e, folder.id)}
                      {...folderDropProps(folder.id)}
                      vaults={vaultOptions.filter((v) => v.id !== (folder.vault_id ?? "personal"))}
                      canEdit={can("EDIT_FOLDERS", folder.vault_id ?? "personal", folder.id)}
                      onMoveToVault={(vaultId) => handleMoveToVault(folder, vaultId)}
                      onCopyToVault={(vaultId) => handleCopyToVault(folder, vaultId)}
                      bulkContextMenuItems={selectedIdSet.size > 1 ? bulkContextMenuItems : undefined}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Eject drop zone (in DOM whenever inside folder, visible only while dragging) ── */}
            {activeFolderId && (
              <FolderEjectZone
                label={ejectTargetFolderId
                  ? t("keychain.page.ejectMoveTo", { name: folderPath[folderPath.length - 2].name })
                  : t("keychain.page.ejectRemoveFromFolder")}
                isDragging={isDragging}
                dragOver={dragOverEject}
                dropProps={ejectDropProps(ejectTargetFolderId)}
              />
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
                    onMoveToVault={handleMoveToVault}
                    onCopyToVault={handleCopyToVault}
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
                    onMoveToVault={handleMoveToVault}
                    onCopyToVault={handleCopyToVault}
                  />
                )}
              </div>
            )}

            {!showKeys && !showIdentities && (
              <FolderEmptyState actions={[
                ...(canEditKeys ? [{ label: t("keychain.cards.keySection.addButton"), onClick: () => openKeyForm(null) }] : []),
                ...(canEditIdentities ? [{ label: t("keychain.cards.identitySection.addButton"), onClick: () => openIdentityForm(null) }] : []),
              ]} />
            )}

            {showKeys && <KeySection
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
              onMoveToVault={handleMoveToVault}
              onCopyToVault={handleCopyToVault}
            />}

            {showIdentities && <IdentitySection
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
              onMoveToVault={handleMoveToVault}
              onCopyToVault={handleCopyToVault}
            />}
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
            { label: t("keychain.toolbar.newFolder"), icon: "lucide:folder-plus", onClick: createFolder, disabledReason: folderBlocked },
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
          onConfirm={whenWritable(async () => {
            for (const id of confirmDeleteIds) {
              if (selectedKeyIds.includes(id)) await handleDeleteKey(id);
              else if (selectedIdentityIds.includes(id)) await handleDeleteIdentity(id);
              else if (scopedFolders.some((f) => f.id === id)) await deleteFolder(id);
            }
            setSelection([]);
            setConfirmDeleteIds(null);
          })}
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


      <ClipboardPill navItem="keychain" />
    </>
  );
}
