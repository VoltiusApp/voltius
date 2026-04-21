import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useUIStore } from "@/stores/uiStore";
import { useUIContributions } from "@/hooks/useUIContributions";

import { DragSelectSurface } from "@/components/shared/DragSelectSurface";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { VaultCascadeModal } from "@/components/shared/VaultCascadeModal";
import { useVaultCascade } from "@/hooks/useVaultCascade";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { usePermissions } from "@/hooks/usePermission";
import { useVaultStore } from "@/stores/vaultStore";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { useDefaultVaultId } from "@/hooks/useWritableVaultIds";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { useDragToFolder } from "@/hooks/useDragToFolder";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { useFolderStore } from "@/stores/folderStore";
import { FolderCard } from "@/components/folders/FolderCard";
import { FolderEditPanel } from "@/components/folders/FolderEditPanel";
import { Icon } from "@iconify/react";
import { KeychainToolbar } from "./KeychainToolbar";
import { KeySection, IdentitySection } from "./KeyCards";
import { KeyForm } from "./KeyForm";
import { KeyGenForm } from "./KeyGenForm";
import { IdentityForm } from "./IdentityForm";
import { KeyExportPanel, sortByMode } from "./KeyExportPanel";
import { getSecret, storeSecret, deleteSecret } from "@/services/vault";
import type { Identity, IdentityFormData, SshKey, SshKeyFormData, VaultOption } from "@/types";
import { SidePanelLayout } from "@/components/shared/SidePanelLayout";

export default function KeychainPage() {
  const { identities, loadIdentities, saveIdentity, updateIdentity, deleteIdentity } =
    useIdentityStore();
  const { keys, loadKeys, saveKey, updateKey, deleteKey } = useKeyStore();
  const { connections, loadConnections } = useConnectionStore();
  const { pending: cascadePending, request: requestCascade, confirm: confirmCascade, cancel: cancelCascade } = useVaultCascade();
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const bgContributions = useUIContributions("keychain.bgContextMenu");
  const keychainPendingAction = useUIStore((s) => s.keychainPendingAction);
  const setKeychainPendingAction = useUIStore((s) => s.setKeychainPendingAction);

  const [editingKey, setEditingKey] = useState<SshKey | null>(null);
  const [editingIdentity, setEditingIdentity] = useState<Identity | null>(null);
  const inlineKeyIdRef = useRef<string | null>(null);
  const keyFormFlushRef = useRef<(() => void) | null>(null);
  const identityFormFlushRef = useRef<(() => void) | null>(null);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [showKeyGenForm, setShowKeyGenForm] = useState(false);
  const [showIdentityForm, setShowIdentityForm] = useState(false);
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
  const { folders, loadFolders, saveFolder, updateFolder, deleteFolder, moveObjectsToFolder, moveFolder } = useFolderStore();

  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const accessibleVaultIds = useAccessibleVaultIds();
  const defaultVaultId = useDefaultVaultId();
  const can = usePermissions();
  const canEditKeys = selectedVaultIds.some((vid) => can("EDIT_KEYS", vid));
  const canEditIdentities = selectedVaultIds.some((vid) => can("EDIT_IDENTITIES", vid));

  const vaultOptions = useMemo<VaultOption[]>(
    () => [
      { id: "personal", name: "Personal" },
      ...vaults.filter((v) => v.id !== "personal").map((v) => ({ id: v.teamId ?? v.id, name: v.name })),
    ],
    [vaults],
  );
  const q = useMemo(() => search.trim().toLowerCase(), [search]);
  const scopedFolders = useMemo(() => folders.filter((f) => f.object_type === "keychain"), [folders]);
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
    () => [...new Set(connections.flatMap((c) => c.tags))].sort(),
    [connections],
  );

  const filteredKeys = useMemo(() =>
    sortByMode(keys.filter((k) => {
      const kvid = k.vault_id ?? "personal";
      if (accessibleVaultIds.length > 0 && !accessibleVaultIds.includes(kvid)) return false;
      if (q && !(k.name ?? "").toLowerCase().includes(q) && !(k.key_type ?? "").toLowerCase().includes(q)) return false;
      if (activeFolderId) return k.folder_id === activeFolderId;
      return scopedFolders.length === 0 || !k.folder_id || !scopedFolderIds.has(k.folder_id);
    }), sortMode),
    [keys, q, sortMode, activeFolderId, scopedFolders, scopedFolderIds, accessibleVaultIds],
  );
  const filteredIdentities = useMemo(() =>
    sortByMode(
      identities.filter((i) => {
        const ivid = i.vault_id ?? "personal";
        if (accessibleVaultIds.length > 0 && !accessibleVaultIds.includes(ivid)) return false;
        if (q && !(i.name ?? "").toLowerCase().includes(q) && !i.username.toLowerCase().includes(q)) return false;
        if (tagFilter.length > 0) {
          const identityTags = new Set(connections.filter((c) => c.identity_id === i.id).flatMap((c) => c.tags));
          if (!tagFilter.some((t) => identityTags.has(t))) return false;
        }
        if (activeFolderId) return i.folder_id === activeFolderId;
        return scopedFolders.length === 0 || !i.folder_id || !scopedFolderIds.has(i.folder_id);
      }),
      sortMode,
    ),
    [identities, connections, q, sortMode, tagFilter, activeFolderId, scopedFolders, scopedFolderIds, accessibleVaultIds],
  );

  const showPanel = showKeyForm || showKeyGenForm || showIdentityForm || exportingKey !== null;

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

  const pinnedKeys = useMemo(
    () => (!q && !activeFolderId) ? filteredKeys.filter((k) => k.pinned) : [],
    [filteredKeys, q, activeFolderId],
  );
  const pinnedIdentities = useMemo(
    () => (!q && !activeFolderId) ? filteredIdentities.filter((i) => i.pinned) : [],
    [filteredIdentities, q, activeFolderId],
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
      if (key) { setEditingKey(key); setShowKeyForm(true); return; }
      const identity = identities.find((i) => i.id === id);
      if (identity) { setEditingIdentity(identity); setShowIdentityForm(true); }
    },
    onEdit: (id) => {
      const key = keys.find((k) => k.id === id);
      if (key) { setEditingKey(key); setShowKeyForm(true); return; }
      const identity = identities.find((i) => i.id === id);
      if (identity) { setEditingIdentity(identity); setShowIdentityForm(true); }
    },
    onEscape: () => {
      if (showPanel) { setShowKeyForm(false); setShowKeyGenForm(false); setShowIdentityForm(false); setExportingKey(null); }
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
    handleDragEnd,
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

  const bulkContextMenuItems = useMemo<ContextMenuItem[] | undefined>(() => {
    if (selectedIdSet.size <= 1) return undefined;
    const allIds = [...selectedIdSet];
    const { isObjectSynced } = useSyncPrefsStore.getState();
    const allSynced = allIds.every((id) => {
      const typeId = selectedKeyIds.includes(id) ? "key" : "identity";
      return isObjectSynced(id, typeId);
    });
    const items: ContextMenuItem[] = [
      {
        label: allSynced ? `Disable cloud sync (${allIds.length})` : `Enable cloud sync (${allIds.length})`,
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
        label: `Export ${selectedKeyIds.length} public key${selectedKeyIds.length === 1 ? "" : "s"}`,
        icon: "lucide:download",
        onClick: () => useUIStore.getState().openImportExport("export", { keyIds: selectedKeyIds, identityIds: selectedIdentityIds }),
      });
    }
    items.push({
      label: `Delete ${allIds.length} item${allIds.length === 1 ? "" : "s"}`,
      icon: "lucide:trash-2",
      onClick: () => setConfirmDeleteIds(allIds),
      danger: true,
      divider: true,
    });
    return items;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdSet, filteredKeys, filteredIdentities, selectedKeyIds, selectedIdentityIds, excludedIds, syncTypes]);

  useEffect(() => {
    void loadKeys();
    void loadIdentities();
    void loadConnections();
    void loadFolders();
  }, [loadKeys, loadIdentities, loadConnections, loadFolders]);

  useEffect(() => {
    const handler = () => {
      if (useUIStore.getState().activeNav !== "keychain") return;
      if (selectedIdSet.size > 0) setConfirmDeleteIds([...selectedIdSet]);
    };
    window.addEventListener("voltius:delete", handler);
    return () => window.removeEventListener("voltius:delete", handler);
  }, [selectedIdSet]);

  useEffect(() => {
    if (!keychainPendingAction) return;
    const { action } = keychainPendingAction;
    if (action === "create-key") {
      setEditingKey(null);
      setShowKeyForm(true);
    } else if (action === "create-identity") {
      setEditingIdentity(null);
      setShowIdentityForm(true);
    } else if (action === "edit-key") {
      const key = keys.find((k) => k.id === (keychainPendingAction as any).id);
      if (key) { setEditingKey(key); setShowKeyForm(true); }
    } else if (action === "edit-identity") {
      const identity = identities.find((i) => i.id === (keychainPendingAction as any).id);
      if (identity) { setEditingIdentity(identity); setShowIdentityForm(true); }
    }
    setKeychainPendingAction(null);
  }, [keychainPendingAction, keys, identities, setKeychainPendingAction]);

  const handleKeySubmit = async (data: SshKeyFormData, privateKey: string | null, publicKey: string | null) => {
    try {
      if (editingKey) {
        await updateKey(editingKey.id, data);
        if (privateKey !== null) {
          if (privateKey) await storeSecret(`key:${editingKey.id}:private`, privateKey);
          else await deleteSecret(`key:${editingKey.id}:private`).catch(() => {});
        }
        if (publicKey !== null) {
          if (publicKey) await storeSecret(`key:${editingKey.id}:public`, publicKey);
          else await deleteSecret(`key:${editingKey.id}:public`).catch(() => {});
        }
      } else {
        const key = await saveKey(data);
        if (privateKey) await storeSecret(`key:${key.id}:private`, privateKey);
        if (publicKey) await storeSecret(`key:${key.id}:public`, publicKey);
        setEditingKey(key);
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
        const keyData = { name: label || undefined, key_type: undefined };
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
          if (password) await storeSecret(`identity:${editingIdentity.id}:password`, password);
          else await deleteSecret(`identity:${editingIdentity.id}:password`).catch(() => {});
        }
      } else {
        const identity = await saveIdentity(resolvedData);
        if (password) await storeSecret(`identity:${identity.id}:password`, password);
        setEditingIdentity(identity);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDeleteKey = async (id: string) => {
    try {
      await deleteKey(id);
      if (editingKey?.id === id) { setEditingKey(null); setShowKeyForm(false); }
    } catch (err) { setError(String(err)); }
  };

  const handleDeleteIdentity = async (id: string) => {
    try {
      await deleteIdentity(id);
      if (editingIdentity?.id === id) { setEditingIdentity(null); setShowIdentityForm(false); }
    } catch (err) { setError(String(err)); }
  };

  const openKeyForm = (key: SshKey | null) => {
    setEditingKey(key);
    if (key) selectSingle(key.id);
    setShowKeyForm(true);
    setShowKeyGenForm(false);
    setShowIdentityForm(false);
    setExportingKey(null);
    setEditingIdentity(null);
  };

  const openKeyGenForm = () => {
    setEditingKey(null);
    setShowKeyGenForm(true);
    setShowKeyForm(false);
    setShowIdentityForm(false);
    setEditingIdentity(null);
  };

  const openIdentityForm = (identity: Identity | null) => {
    setEditingIdentity(identity);
    if (identity) selectSingle(identity.id);
    setShowIdentityForm(true);
    setShowKeyForm(false);
    setShowKeyGenForm(false);
    setEditingKey(null);
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
    setShowKeyGenForm(false);
    setShowIdentityForm(false);
    setEditingKey(null);
    setEditingIdentity(null);
  };

  const closePanel = () => {
    setShowKeyForm(false);
    setShowKeyGenForm(false);
    setShowIdentityForm(false);
    setExportingKey(null);
    setEditingKey(null);
    inlineKeyIdRef.current = null;
    setEditingIdentity(null);
  };

  const handleGenerateKey = async (
    privateKey: string,
    publicKey: string,
    keyTypeLabel: string,
    passphrase: string,
    savePassphrase: boolean,
    label: string,
  ) => {
    try {
      const key = await saveKey({ name: label || undefined, key_type: keyTypeLabel });
      await storeSecret(`key:${key.id}:private`, privateKey);
      if (publicKey) await storeSecret(`key:${key.id}:public`, publicKey);
      if (passphrase && savePassphrase) await storeSecret(`key:${key.id}:passphrase`, passphrase);
      setEditingKey(key);
      setShowKeyGenForm(false);
      setShowKeyForm(true);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleMoveKeyToVault = async (key: SshKey, vaultId: string) => {
    try { await updateKey(key.id, { vault_id: vaultId }); }
    catch (err) { setError(String(err)); }
  };

  const handleCopyKeyToVault = async (key: SshKey, vaultId: string) => {
    try {
      const newKey = await saveKey({ name: key.name, key_type: key.key_type, vault_id: vaultId });
      const [priv, pub] = await Promise.all([
        getSecret(`key:${key.id}:private`).catch(() => null),
        getSecret(`key:${key.id}:public`).catch(() => null),
      ]);
      if (priv) await storeSecret(`key:${newKey.id}:private`, priv);
      if (pub) await storeSecret(`key:${newKey.id}:public`, pub);
    } catch (err) { setError(String(err)); }
  };

  const handleMoveIdentityToVault = (identity: Identity, vaultId: string) => {
    const key = identity.key_id ? keys.find((k) => k.id === identity.key_id) : undefined;
    const keyNeedsMove = key && (key.vault_id ?? "personal") !== vaultId;
    const targetVaultName = vaultOptions.find((v) => v.id === vaultId)?.name ?? vaultId;

    requestCascade({
      operation: "move",
      targetVaultName,
      items: keyNeedsMove ? [{ type: "key" as const, label: key.name ?? "Unnamed key" }] : [],
      execute: async () => {
        try {
          if (keyNeedsMove) await updateKey(key.id, { name: key.name, key_type: key.key_type, folder_id: key.folder_id, vault_id: vaultId });
          await updateIdentity(identity.id, {
            name: identity.name, username: identity.username,
            key_id: identity.key_id, folder_id: identity.folder_id, vault_id: vaultId,
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
      items: keyNeedsCopy ? [{ type: "key" as const, label: key.name ?? "Unnamed key" }] : [],
      execute: async () => {
        try {
          let newKeyId = identity.key_id;

          if (keyNeedsCopy) {
            const newKey = await saveKey({ name: key.name, key_type: key.key_type, vault_id: vaultId });
            const [priv, pub] = await Promise.all([
              getSecret(`key:${key.id}:private`).catch(() => null),
              getSecret(`key:${key.id}:public`).catch(() => null),
            ]);
            if (priv) await storeSecret(`key:${newKey.id}:private`, priv);
            if (pub) await storeSecret(`key:${newKey.id}:public`, pub);
            newKeyId = newKey.id;
          }

          const newIdentity = await saveIdentity({ name: identity.name, username: identity.username, key_id: newKeyId, vault_id: vaultId });
          const pwd = await getSecret(`identity:${identity.id}:password`).catch(() => null);
          if (pwd) await storeSecret(`identity:${newIdentity.id}:password`, pwd);
        } catch (err) { setError(String(err)); }
      },
    });
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
              onExport={() => useUIStore.getState().openImportExport("export", { keyIds: keys.filter((k) => k.folder_id === editingFolder.id).map((k) => k.id), identityIds: identities.filter((i) => i.folder_id === editingFolder.id).map((i) => i.id) })}
              onClose={() => setEditingFolderId(null)}
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
              key={editingKey?.id ?? "new-key"}
              initial={editingKey ?? undefined}
              onSubmit={handleKeySubmit}
              onClose={closePanel}
              onExport={openExportPanel}
              onDelete={editingKey ? handleDeleteKey : undefined}
              flushRef={keyFormFlushRef}
              vaults={editingKey ? vaultOptions.filter((v) => v.id !== (editingKey.vault_id ?? "personal")) : []}
              canEdit={editingKey ? can("EDIT_KEYS", editingKey.vault_id ?? "personal") : false}
              onMoveToVault={editingKey ? (vaultId) => { void handleMoveKeyToVault(editingKey, vaultId); } : undefined}
              onCopyToVault={editingKey ? (vaultId) => { void handleCopyKeyToVault(editingKey, vaultId); } : undefined}
            />
          )}
          {showKeyGenForm && (
            <KeyGenForm
              onGenerate={handleGenerateKey}
              onClose={closePanel}
            />
          )}
          {showIdentityForm && (
            <IdentityForm
              key={editingIdentity?.id ?? "new-identity"}
              initial={editingIdentity ?? undefined}
              onSubmit={handleIdentitySubmit}
              onClose={closePanel}
              onDelete={editingIdentity ? handleDeleteIdentity : undefined}
              flushRef={identityFormFlushRef}
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
          onNewFolder={() => void saveFolder({ name: "New Folder", object_type: "keychain", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId })}
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
                  className="flex items-center gap-1.5 text-xs transition-colors text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)]"
                  onClick={navigateToRoot}
                >
                  <Icon icon="lucide:chevron-left" width={13} />
                  All
                </button>
                {folderPath.map((folder, i) => (
                  <span key={folder.id} className="flex items-center gap-2">
                    <span className="text-[var(--t-text-dim)]">/</span>
                    {i < folderPath.length - 1 ? (
                      <button
                        className="text-xs transition-colors text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)]"
                        onClick={() => navigateTo(i)}
                      >
                        {folder.name}
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-[var(--t-text-primary)]">
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
                  <p className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">
                    Folders
                  </p>
                  <button
                    className="flex items-center gap-1 text-xs transition-colors px-2 py-1 rounded-lg text-[var(--t-text-dim)]"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--t-text-primary)";
                      e.currentTarget.style.background = "var(--t-bg-elevated)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--t-text-dim)";
                      e.currentTarget.style.background = "transparent";
                    }}
                    onClick={() => void saveFolder({ name: "New Folder", object_type: "keychain", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId })}
                  >
                    <Icon icon="lucide:plus" width={12} />
                    New
                  </button>
                </div>
                <div
                  className={layoutMode === "grid" ? "grid gap-3" : "flex flex-col gap-1.5"}
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
                      onClick={() => navigateInto(folder)}
                      onRename={(f, newName) => void updateFolder(f.id, { name: newName, object_type: f.object_type, parent_folder_id: f.parent_folder_id })}
                      onDelete={(f) => setConfirmDeleteFolderId(f.id)}
                      onSelect={(id) => { if (!selectedIdSet.has(id)) selectSingle(id); }}
                      onEdit={() => { closePanel(); setEditingFolderId(folder.id); }}
                      onExport={() => useUIStore.getState().openImportExport("export", { keyIds: keys.filter((k) => k.folder_id === folder.id).map((k) => k.id), identityIds: identities.filter((i) => i.folder_id === folder.id).map((i) => i.id) })}
                      onDragStart={(e) => handleFolderDragStart(e, folder.id)}
                      onDragEnd={handleDragEnd}
                      {...folderDropProps(folder.id)}
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
                  {ejectTargetFolderId ? `Move to ${folderPath[folderPath.length - 2].name}` : "Remove from folder"}
                </span>
              </div>
            )}

            {(pinnedKeys.length > 0 || pinnedIdentities.length > 0) && (
              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">Pinned</p>
                {pinnedKeys.length > 0 && (
                  <KeySection
                    keys={pinnedKeys}
                    label="SSH Keys"
                    showDraft={false}
                    editingId={editingKey?.id ?? null}
                    selectedIdSet={selectedIdSet}
                    layoutMode={layoutMode}
                    focusedId={focusedId}
                    onEdit={openKeyForm}
                    onDelete={handleDeleteKey}
                    onSelect={handleKeySelect}
                    onExport={openExportPanel}
                    bulkContextMenuItems={bulkContextMenuItems}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    vaultOptions={vaultOptions}
                    onMoveToVault={handleMoveKeyToVault}
                    onCopyToVault={handleCopyKeyToVault}
                  />
                )}
                {pinnedIdentities.length > 0 && (
                  <IdentitySection
                    identities={pinnedIdentities}
                    keys={keys}
                    connections={connections}
                    label="Identities"
                    layoutMode={layoutMode}
                    showDraft={false}
                    editingId={editingIdentity?.id ?? null}
                    selectedIdSet={selectedIdSet}
                    focusedId={focusedId}
                    onEdit={openIdentityForm}
                    onDelete={handleDeleteIdentity}
                    onSelect={handleIdentitySelect}
                    bulkContextMenuItems={bulkContextMenuItems}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
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
              onAdd={canEditKeys ? () => openKeyForm(null) : undefined}
              onEdit={openKeyForm}
              onDelete={handleDeleteKey}
              onSelect={handleKeySelect}
              onExport={openExportPanel}
              bulkContextMenuItems={bulkContextMenuItems}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              vaultOptions={vaultOptions}
              onMoveToVault={handleMoveKeyToVault}
              onCopyToVault={handleCopyKeyToVault}
            />

            <IdentitySection
              identities={filteredIdentities}
              keys={keys}
              connections={connections}
              layoutMode={layoutMode}
              showDraft={showIdentityForm && !editingIdentity}
              editingId={editingIdentity?.id ?? null}
              selectedIdSet={selectedIdSet}
              focusedId={focusedId}
              onAdd={canEditIdentities ? () => openIdentityForm(null) : undefined}
              onEdit={openIdentityForm}
              onDelete={handleDeleteIdentity}
              onSelect={handleIdentitySelect}
              bulkContextMenuItems={bulkContextMenuItems}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
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
              { label: "New Key", icon: "lucide:key-round", onClick: () => openKeyForm(null) },
              { label: "Generate Key Pair", icon: "lucide:sparkles", onClick: openKeyGenForm },
            ] : []),
            ...(canEditIdentities ? [
              { label: "New Identity", icon: "lucide:user-plus", onClick: () => openIdentityForm(null) },
            ] : []),
            { label: "New Folder", icon: "lucide:folder-plus", onClick: () => void saveFolder({ name: "New Folder", object_type: "keychain", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }) },
            ...bgContributions,
          ]}
        />
      )}

      {confirmDeleteFolderId && (
        <ConfirmModal
          title="Delete folder"
          message="This will delete the folder. Items inside won't be deleted — they'll return to the top level."
          confirmLabel="Delete"
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
          title={`Delete ${confirmDeleteIds.length} item${confirmDeleteIds.length === 1 ? "" : "s"}`}
          message={`Are you sure you want to delete ${confirmDeleteIds.length} item${confirmDeleteIds.length === 1 ? "" : "s"}? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            for (const id of confirmDeleteIds) {
              if (selectedKeyIds.includes(id)) await handleDeleteKey(id);
              else await handleDeleteIdentity(id);
            }
            setSelection([]);
            setConfirmDeleteIds(null);
          }}
          onCancel={() => setConfirmDeleteIds(null)}
        />
      )}

    </SidePanelLayout>

      {cascadePending && (
        <VaultCascadeModal
          cascade={cascadePending}
          onConfirm={() => { void confirmCascade(); }}
          onCancel={cancelCascade}
        />
      )}
    </>
  );
}
