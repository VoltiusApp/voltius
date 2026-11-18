import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cardGridProps } from "@/components/shared/cardGrid";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionAddButton, SectionHeader } from "@/components/shared/SectionHeader";
import { useTranslation } from "react-i18next";
import { matchesSearch, compareConnections } from "@/utils/connectionFilter";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { TeamCredentialsNote } from "@/components/shared/VaultUnavailableNote";
import { useTeamCredentialsUnavailable } from "@/hooks/useBlockedTeamVault";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { useConnectionStore, connectionToFormData } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useShortcutHint } from "@/stores/shortcutStore";
import { useUIStore } from "@/stores/uiStore";
import { useFolderStore } from "@/stores/folderStore";
import { useUIContributions } from "@/hooks/useUIContributions";
import type { Connection, ConnectionFormData, Folder, NewObjectPlacement } from "@/types";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { usePageBulkActions } from "@/hooks/usePageBulkActions";
import { useDragToFolder } from "@/hooks/useDragToFolder";
import { folderDragHandlers } from "@/utils/folderDragHandlers";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { useNewFolder } from "@/hooks/useNewFolder";
import { DragSelectSurface } from "@/components/shared/DragSelectSurface";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { VaultCascadeModal } from "@/components/shared/VaultCascadeModal";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useEffectivePinnedPredicate } from "@/hooks/useEffectivePinned";
import { usePermissions } from "@/hooks/usePermission";
import { useCloseWhenGone } from "@/hooks/useCloseWhenGone";
import { useAccessibleVaultIds, useScopedVaultId } from "@/hooks/useAccessibleVaultIds";
import { useVaultObjectsClipboard } from "@/hooks/useVaultObjectsClipboard";
import { storeObjectPorts } from "@/services/vaultObjectStores";
import { duplicateInPlace } from "@/services/vaultObjectWrites";
import { useCrossVaultPasteConfirm } from "@/hooks/useCrossVaultPasteConfirm";
import { ClipboardPill } from "@/components/shared/ClipboardPill";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import { getShortcutHint } from "@/stores/shortcutStore";
import { clipboardMenuItems } from "@/utils/clipboardMenuItems";
import { FolderCard } from "@/components/folders/FolderCard";

import { FolderEditPanel } from "@/components/folders/FolderEditPanel";
import { FolderEmptyState } from "@/components/folders/FolderEmptyState";
import HostCard from "./HostCard";
import ConnectionForm, { type ConnectionFormHandle } from "@/components/connections/ConnectionForm";
import SerialConnectionForm from "@/components/connections/SerialConnectionForm";
import { placementIn } from "@/components/shared/vaultObjectForm";
import { HomeToolbar } from "./HostsToolbar";
import { TeamSessions } from "./TeamSessions";
import { RemoteDeviceSessions } from "./RemoteDeviceSessions";
import { SidePanelLayout } from "@/components/shared/SidePanelLayout";
import { useSyncedFormKey } from "@/hooks/useSyncedFormKey";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useAllFolders } from "@/hooks/useAllFolders";
import { SnippetPickerPanel } from "./SnippetPickerPanel";
import { getHostDeleteTargetIds, shouldUseBulkHostContextMenu } from "./hostSelection";
import { buildTeamVaultTransferPlan, type TransferOperation } from "@/services/teamVaultPermissions";
import { saveHostFromForm, type HostFormSecrets } from "@/services/hostForm";
import { foldersOutsideSubtree, itemsInFolderSubtree, folderItemCounter } from "@/utils/folderTree";
import { exceptItems, folderAwareKeys, selectFollowing } from "@/utils/cardInteraction";
import { folderDeleteMessages } from "@/utils/folderDeleteMessages";
import { useVaultOptions } from "@/hooks/useVaultOptions";
import { useScopedFolders } from "@/hooks/useScopedFolders";
import { FolderBreadcrumb } from "@/components/folders/FolderBreadcrumb";
import { FolderEjectZone } from "@/components/folders/FolderEjectZone";
import { passMoveCancelled } from "@/services/teamObjectPersistence";
import { describeError } from "@/services/backendErrors";
import { connectionTarget, folderTarget, refuseWhilePreviewing, whenWritable } from "@/services/previewGuard";


export default function HostsPage() {
  const { t } = useTranslation();
  const omniHint = useShortcutHint("omni");
  const { loadConnections, updateConnection, deleteConnection, renameTag, deleteTag } =
    useConnectionStore();
  const connections = useAllConnections();
  const { identities } = useIdentityStore();
  const { keys } = useKeyStore();
  const crossVaultPaste = useCrossVaultPasteConfirm();
  const { connect, connectMany, connectLocal, connectSerialEphemeral, sessions } = useSessionStore();
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const bgContributions = useUIContributions("home.bgContextMenu");
  const { pos: bgMenuPos, open: openBgMenu, close: closeBgMenu } = useContextMenu();
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const layoutMode = useUIStore((s) => s.homeLayoutMode);
  const setLayoutMode = useUIStore((s) => s.setHomeLayoutMode);
  const sortMode = useUIStore((s) => s.homeSortMode);
  const setSortMode = useUIStore((s) => s.setHomeSortMode);
  const homePendingAction = useUIStore((s) => s.homePendingAction);
  const setHomePendingAction = useUIStore((s) => s.setHomePendingAction);
  const openSessions = useLayoutStore((s) => s.openSessions);
  const { loadFolders, saveFolder, updateFolder, deleteFolder, moveObjectsToFolder, moveFolder } = useFolderStore();
  const folders = useAllFolders();
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showSerialForm, setShowSerialForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newPlacement, setNewPlacement] = useState<NewObjectPlacement>();
  const editing = editingId ? (connections.find((c) => c.id === editingId) ?? null) : null;
  const isEditingSerial = editing?.connection_type === "serial";
  const [error, setError] = useState<string | null>(null);
  const reportSaveError = passMoveCancelled(setError);
  const formRef = useRef<ConnectionFormHandle>(null);
  const serialFormRef = useRef<ConnectionFormHandle>(null);
  const hostFormSessionKeyRef = useRef<string>("new");
  const formVersion = useSyncedFormKey(editing?.updated_at, showForm || showSerialForm, () => (formRef.current?.isDirty() ?? serialFormRef.current?.isDirty() ?? false));
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [showSnippetPicker, setShowSnippetPicker] = useState(false);
  const [snippetConnectionIds, setSnippetConnectionIds] = useState<string[]>([]);


  useEffect(() => {
    void loadConnections();
    void loadFolders();
  }, [loadConnections, loadFolders]);

  const openEdit = (conn: { id: string; connection_type?: string }) => {
    if (refuseWhilePreviewing(connectionTarget(conn.id))) return;
    hostFormSessionKeyRef.current = conn.id;
    setEditingId(conn.id);
    setEditingFolderId(null);
    if (conn.connection_type === "serial") {
      setShowSerialForm(true);
      setShowForm(false);
    } else {
      setShowForm(true);
      setShowSerialForm(false);
    }
  };

  const openNew = (serial = false, inOpenFolder = true) => {
    if (refuseWhilePreviewing()) return;
    hostFormSessionKeyRef.current = `new-${Date.now()}`;
    const openFolder = inOpenFolder ? folders.find((f) => f.id === activeFolderId) : undefined;
    setNewPlacement(openFolder && can("EDIT_CONNECTIONS", openFolder.vault_id) ? placementIn(openFolder) : undefined);
    setEditingId(null);
    setShowForm(!serial);
    setShowSerialForm(serial);
    setEditingFolderId(null);
  };

  const createFolder = () =>
    void addFolder(t("hosts.toolbar.newFolder"))?.then((f) => {
      setShowForm(false); setShowSerialForm(false); setEditingId(null); setEditingFolderId(f.id);
    });

  useEffect(() => {
    if (!homePendingAction) return;
    if (homePendingAction.action === "create") {
      openNew(false, false);
    } else if (homePendingAction.action === "edit") {
      const conn = connections.find((c) => c.id === homePendingAction.id);
      if (conn) openEdit(conn);
    }
    setHomePendingAction(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homePendingAction, connections, setHomePendingAction]);

  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const accessibleVaultIds = useAccessibleVaultIds();
  const scopedVaultId = useScopedVaultId();
  const can = usePermissions();
  const canCreate = selectedVaultIds.some((vid) => can("EDIT_CONNECTIONS", vid));
  const teamCredentialsUnavailable = useTeamCredentialsUnavailable();

  const vaultOptions = useVaultOptions();

  const searchQuery = search.trim();

  const scopedConnections = useMemo(
    () => connections.filter((c) => {
      const cvid = c.vault_id ?? "personal";
      return accessibleVaultIds.length === 0 || accessibleVaultIds.includes(cvid);
    }),
    [connections, accessibleVaultIds],
  );

  const availableTags = useMemo(
    () => [...new Set(scopedConnections.flatMap((c) => c.tags))].sort(),
    [scopedConnections],
  );

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of scopedConnections) {
      for (const t of c.tags) counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }, [scopedConnections]);

  const scopedFolders = useScopedFolders(folders, accessibleVaultIds, "connection");
  // Every vault's, not only those on screen: the clipboard outlives a vault switch.
  const connectionFolders = useMemo(() => folders.filter((f) => f.object_type === "connection"), [folders]);
  const scopedFolderIds = useMemo(() => new Set(scopedFolders.map((f) => f.id)), [scopedFolders]);
  const editingFolder = editingFolderId ? scopedFolders.find((f) => f.id === editingFolderId) ?? null : null;
  useCloseWhenGone(editingId, editing !== null, () => { setShowForm(false); setShowSerialForm(false); setEditingId(null); });
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
  } = useFolderNavigation(scopedFolders, "connection");
  const { folderBlocked, addFolder } = useNewFolder("connection", folderPath, saveFolder);

  // When inside a folder, show only that folder's items; otherwise show unfoldered items
  const filtered = useMemo(() => {
    return connections
      .filter((c) => {
        // Vault filter — team vaults are excluded when server is unreachable
        const cvid = c.vault_id ?? "personal";
        if (accessibleVaultIds.length > 0 && !accessibleVaultIds.includes(cvid)) return false;
        if (!matchesSearch(c, searchQuery)) return false;
        if (tagFilter.length > 0 && !tagFilter.some((t) => c.tags.includes(t))) return false;
        if (activeFolderId) return c.folder_id === activeFolderId;
        // Top level: show unfoldered connections, or connections whose folder no longer exists
        return scopedFolders.length === 0 || !c.folder_id || !scopedFolderIds.has(c.folder_id);
      })
      .sort((a, b) => compareConnections(a, b, sortMode));
  }, [connections, searchQuery, sortMode, tagFilter, activeFolderId, scopedFolders, scopedFolderIds, accessibleVaultIds]);

  const isPinnedFn = useEffectivePinnedPredicate();
  const pinnedHosts = useMemo(
    () => (!searchQuery && !activeFolderId) ? filtered.filter((c) => isPinnedFn(c, "connection")) : [],
    [filtered, searchQuery, activeFolderId, isPinnedFn],
  );
  const mainHosts = useMemo(() => exceptItems(filtered, pinnedHosts), [filtered, pinnedHosts]);

  const filteredIds = useMemo(
    () => [...visibleFolders, ...pinnedHosts, ...mainHosts].map((x) => x.id),
    [visibleFolders, pinnedHosts, mainHosts],
  );
  const activeConnectionIds = useMemo(
    () => new Set(sessions.map((s) => s.connectionId)),
    [sessions],
  );
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);

  const {
    selectedIdSet,
    selectionAreaRef,
    itemAreaRef,
    dragBox,
    handleItemSelect,
    handleSelectionAreaMouseDown,
    selectSingle,
    setSelection,
  } = useDragSelection(filteredIds);

  const selectedConnections = useMemo(
    () => filtered.filter((c) => selectedIdSet.has(c.id)),
    [filtered, selectedIdSet],
  );
  const selectedFolders = useMemo(
    () => visibleFolders.filter((f) => selectedIdSet.has(f.id)),
    [visibleFolders, selectedIdSet],
  );

  const editFolder = (folder: Folder) => {
    if (refuseWhilePreviewing(folderTarget(folder.id))) return;
    setShowForm(false); setShowSerialForm(false); setEditingId(null); setEditingFolderId(folder.id);
  };
  const panelOpen = showForm || showSerialForm || editingFolderId !== null;

  const { focusedId, setFocusedId } = useListKeyNav({
    orderedIds: filteredIds,
    selectedIdSet,
    selectSingle,
    setSelection,
    itemAreaRef,
    layoutMode,
    ...folderAwareKeys(visibleFolders, { open: navigateInto, edit: editFolder }, {
      enter: (id) => { const conn = connections.find((c) => c.id === id); if (conn) void handleConnect(conn); },
      edit: (id) => { const conn = connections.find((c) => c.id === id); if (conn) { selectSingle(conn.id); openEdit(conn); } },
    }),
    onDuplicate: (id) => {
      const conn = connections.find((c) => c.id === id);
      if (conn) void handleDuplicate(conn);
    },
    onEscape: () => {
      if (showForm || showSerialForm || editingFolderId || showSnippetPicker) { setShowForm(false); setShowSerialForm(false); setEditingId(null); setEditingFolderId(null); setShowSnippetPicker(false); setSnippetConnectionIds([]); }
      else setSelection([]);
    },
    onSearch: () => setOmniOpen(true),
    onBackspace: () => { if (activeFolderId) navigateToRoot(); },
  });

  useEffect(() => { setFocusedId(null); }, [activeFolderId]);

  usePageBulkActions({
    navItem: "hosts",
    filteredIds,
    selectedIdSet,
    setSelection,
    onDelete: (ids) => setConfirmDeleteIds(ids),
  });

  // ── Cut / copy / paste ────────────────────────────────────────────────────

  const clipboard = useVaultClipboardStore((s) => s.clipboard);
  const cutIds = useMemo(
    () =>
      new Set(
        clipboard?.tab === "hosts" && clipboard.mode === "cut"
          ? [...clipboard.items.map((i) => i.id), ...clipboard.folderIds]
          : [],
      ),
    [clipboard],
  );

  const { transferToVault, moveToVault: handleMoveToVault, copyToVault: handleCopyToVault } = useVaultObjectsClipboard("hosts", {
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

  // ── Drag-to-folder ────────────────────────────────────────────────────────

  const visibleFolderIds = useMemo(() => new Set(visibleFolders.map((f) => f.id)), [visibleFolders]);

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
      moveItems: async (ids, folderId) => {
        await moveObjectsToFolder(ids, "connection", folderId);
        await loadConnections();
      },
      moveFolders: async (folderDragIds, targetParentId) => {
        for (const id of folderDragIds) await moveFolder(id, targetParentId);
        await loadFolders();
      },
      onError: setError,
    }),
  });

  const handleDuplicate = async (conn: Connection) => {
    if (refuseWhilePreviewing(connectionTarget(conn.id))) return;
    try {
      await duplicateInPlace(storeObjectPorts, "connection", conn);
    } catch (err) {
      setError(describeError(err, t));
    }
  };

  const openSnippetPicker = useCallback((connectionIds: string[]) => {
    setSnippetConnectionIds(connectionIds);
    setShowSnippetPicker(true);
    setShowForm(false);
    setShowSerialForm(false);
    setEditingFolderId(null);
  }, []);

  const excludedIds = useSyncPrefsStore((s) => s.excludedIds);
  const syncTypes = useSyncPrefsStore((s) => s.syncTypes);

  const handleBulkConnect = useCallback(async (conns: Connection[]) => {
    if (refuseWhilePreviewing()) return;
    const connectionIds = conns.map((c) => c.id);
    if (connectionIds.length === 0) return;
    setError(null);
    setActiveNav("terminal");
    try {
      const sessionIds = await connectMany(connectionIds);
      if (sessionIds.length > 0) openSessions(sessionIds);
    } catch (err) {
      setError(describeError(err, t));
    }
  }, [connectMany, openSessions, setActiveNav]);

  const handleConnect = useCallback(async (conn: Connection) => {
    if (refuseWhilePreviewing(connectionTarget(conn.id))) return;
    if (selectedIdSet.size > 1 && selectedIdSet.has(conn.id) && selectedConnections.length > 1) {
      await handleBulkConnect(selectedConnections);
      return;
    }

    setError(null);
    // Persist any pending edits (e.g. a just-typed inline password) before
    // connecting, so credential resolution sees them.
    formRef.current?.flush();
    setActiveNav("terminal");
    try {
      await connect(conn.id);
    } catch {
      // Error is shown in ConnectionOverlay
    }
  }, [connect, handleBulkConnect, selectedConnections, selectedIdSet, setActiveNav]);

  const handleDeleteConnection = useCallback((id: string) => {
    if (refuseWhilePreviewing(connectionTarget(id))) return;
    const targetIds = getHostDeleteTargetIds(id, selectedIdSet, selectedConnections.map((c) => c.id));
    if (targetIds.length > 1) {
      setConfirmDeleteIds(targetIds);
      return;
    }
    void deleteConnection(id);
  }, [deleteConnection, selectedConnections, selectedIdSet]);

  const bulkContextMenuItems = useMemo<ContextMenuItem[] | undefined>(() => {
    if (selectedIdSet.size === 0) return undefined;
    const selectedConns = selectedConnections;
    const ids = selectedConns.map((c) => c.id);
    const folderIds = selectedFolders.map((f) => f.id);
    const totalSelected = ids.length + folderIds.length;
    if (totalSelected === 0) return undefined;
    const { isObjectSynced } = useSyncPrefsStore.getState();
    const allSynced = selectedConns.every((c) => isObjectSynced(c.id, "connection"));
    const allCanEdit = selectedConns.every((c) => can("EDIT_CONNECTIONS", c.vault_id ?? "personal", c.id));
    const bulkVaultChildren = (operation: TransferOperation): ContextMenuItem[] => vaultOptions
      .filter((v) => [...selectedConns.map((c) => c.vault_id ?? "personal"), ...selectedFolders.map((f) => f.vault_id ?? "personal")].some((sourceVaultId) => sourceVaultId !== v.id))
      .filter((v) => buildTeamVaultTransferPlan({
        operation,
        targetVaultId: v.id,
        selected: { connectionIds: ids, folderIds },
        can,
        connections,
        identities,
        keys,
        folders: scopedFolders,
        snippets: [],
        snippetFolders: [],
      }).allowed)
      .map((v) => ({
        label: v.name,
        icon: operation === "move" ? "lucide:vault" : "lucide:copy-plus",
        onClick: () => transferToVault([...folderIds, ...ids], v.id, operation === "move" ? "cut" : "copy"),
      }));
    const moveChildren = bulkVaultChildren("move");
    const copyChildren = bulkVaultChildren("copy");
    return [
      {
        label: t("hosts.page.bulk.executeSnippetOn", { count: ids.length }),
        icon: "lucide:braces",
        onClick: () => openSnippetPicker(ids),
        divider: true,
      },
      ...(selectedConns.length > 1 ? [{
        label: t("hosts.page.bulk.connectHosts", { count: selectedConns.length }),
        icon: "lucide:terminal",
        onClick: () => { void handleBulkConnect(selectedConns); },
        divider: true,
      }] : []),
      ...(allCanEdit ? [{
        label: t("hosts.page.bulk.duplicateHosts", { count: ids.length }),
        icon: "lucide:copy",
        onClick: () => { void Promise.all(selectedConns.map((c) => handleDuplicate(c))); },
      }] : []),
      ...(moveChildren.length > 0 ? [{
        label: t("hosts.page.bulk.moveItemsTo", { count: totalSelected }),
        icon: "lucide:vault",
        children: moveChildren,
        divider: true,
      }] : []),
      ...(copyChildren.length > 0 ? [{
        label: t("hosts.page.bulk.copyItemsTo", { count: totalSelected }),
        icon: "lucide:copy-plus",
        children: copyChildren,
      }] : []),
      {
        label: allSynced ? t("common.objectSync.disableCount", { count: ids.length }) : t("common.objectSync.enableCount", { count: ids.length }),
        icon: allSynced ? "lucide:cloud-off" : "lucide:cloud",
        onClick: () => useSyncPrefsStore.getState().setObjectsSynced(selectedConns.map((c) => ({ id: c.id, typeId: "connection" })), !allSynced),
        divider: true,
      },
      {
        label: selectedConns.every((c) => c.ping_disabled) ? t("hosts.page.bulk.enableReachability", { count: ids.length }) : t("hosts.page.bulk.disableReachability", { count: ids.length }),
        icon: selectedConns.every((c) => c.ping_disabled) ? "lucide:wifi" : "lucide:wifi-off",
        onClick: () => {
          const allDisabled = selectedConns.every((c) => c.ping_disabled);
          void Promise.all(selectedConns.map((c) => updateConnection(c.id, { ...connectionToFormData(c), ping_disabled: !allDisabled })));
        },
      },
      {
        label: t("hosts.page.bulk.exportHosts", { count: ids.length }),
        icon: "lucide:upload",
        onClick: () => useUIStore.getState().openImportExport("export", { bulk: { connections: ids } }),
      },
      ...clipboardMenuItems(t),
      {
        label: t("hosts.page.bulk.deleteItems", { count: totalSelected }),
        icon: "lucide:trash-2",
        onClick: whenWritable(() => setConfirmDeleteIds([...ids, ...folderIds])),
        danger: true,
        divider: true,
      },
    ];
  }, [t, selectedIdSet, selectedConnections, selectedFolders, excludedIds, syncTypes, handleDuplicate, can, updateConnection, handleBulkConnect, openSnippetPicker, vaultOptions, connections, identities, keys, scopedFolders]);

  const handleSubmit = async (data: ConnectionFormData, secrets: HostFormSecrets) => {
    try {
      await saveHostFromForm(editing, data, secrets, selectedVaultIds[0] ?? "personal", (created) => setEditingId(created.id));
    } catch (err) {
      reportSaveError(err);
    }
  };

  // ── Folder vault move / copy ──────────────────────────────────────────────

  /** Returns all connections nested anywhere under folderId. */
  function getConnectionsInFolderTree(folderId: string): Connection[] {
    return itemsInFolderSubtree(connections, connectionFolders, folderId);
  }

  const { folderDeleteMessage, bulkDeleteMessage } = folderDeleteMessages({
    t,
    prefix: "hosts.page",
    folders: scopedFolders,
    itemIdsInFolderTree: (id) => getConnectionsInFolderTree(id).map((c) => c.id),
  });

  // ── Drag-to-folder ────────────────────────────────────────────────────────

  const folderCount = useMemo(() => folderItemCounter(connections, scopedFolders), [connections, scopedFolders]);

  const renderHost = (conn: Connection) => {
    const connVaultId = conn.vault_id ?? "personal";
    return (
      <HostCard
        key={conn.id}
        connection={conn}
        layout={layoutMode}
        isActive={activeConnectionIds.has(conn.id)}
        isSelected={selectedIdSet.has(conn.id)}
        isFocused={focusedId === conn.id}
        isEditing={editing?.id === conn.id}
        dimmed={cutIds.has(conn.id)}
        canEdit={can("EDIT_CONNECTIONS", connVaultId, conn.id)}
        vaults={vaultOptions.filter((v) => v.id !== connVaultId)}
        onSelect={selectFollowing(handleItemSelect, panelOpen, () => openEdit(conn))}
        onConnect={handleConnect}
        onEdit={(c) => { selectSingle(c.id); openEdit(c); }}
        onDuplicate={handleDuplicate}
        onExecuteSnippet={(c) => openSnippetPicker([c.id])}
        onDelete={handleDeleteConnection}
        onMoveToVault={handleMoveToVault}
        onCopyToVault={handleCopyToVault}
        bulkContextMenuItems={shouldUseBulkHostContextMenu(selectedConnections.length) ? bulkContextMenuItems : undefined}
        onPointerDown={(e) => handleDragStart(e, conn.id)}
      />
    );
  };

  const closeHostForm = () => { setShowForm(false); setShowSerialForm(false); setEditingId(null); };
  const hostFormProps = {
    initial: editing ?? undefined,
    placement: newPlacement,
    onSubmit: handleSubmit,
    onClose: closeHostForm,
    onDuplicate: editing ? () => handleDuplicate(editing) : undefined,
    onConnect: editing ? () => void handleConnect(editing) : undefined,
    onDelete: editing ? () => { deleteConnection(editing.id); closeHostForm(); } : undefined,
    vaults: editing ? vaultOptions.filter((v) => v.id !== (editing.vault_id ?? "personal")) : [],
    onMoveToVault: editing ? (vaultId: string) => handleMoveToVault(editing, vaultId) : undefined,
    onCopyToVault: editing ? (vaultId: string) => handleCopyToVault(editing, vaultId) : undefined,
  };

  return (
    <>
    <SidePanelLayout
      panelOpen={showForm || showSerialForm || editingFolder !== null || showSnippetPicker}
      panelWidth={showSnippetPicker ? 300 : 320}
      className="chrome-canvas"
      panel={
        <>
          {showSnippetPicker && (
            <SnippetPickerPanel
              connectionIds={snippetConnectionIds}
              onClose={() => { setShowSnippetPicker(false); setSnippetConnectionIds([]); }}
            />
          )}
          {!showSnippetPicker && editingFolder && (
            <FolderEditPanel
              folder={editingFolder}
              onUpdate={updateFolder}
              onDelete={(f) => setConfirmDeleteFolderId(f.id)}
              onExport={() => useUIStore.getState().openImportExport("export", { bulk: { connections: connections.filter((c) => c.folder_id === editingFolder.id).map((c) => c.id) } })}
              onClose={() => setEditingFolderId(null)}
              onOpen={() => { navigateInto(editingFolder); setEditingFolderId(null); }}
              onSelectSelf={() => selectSingle(editingFolder.id)}
              parentOptions={foldersOutsideSubtree(scopedFolders, editingFolder.id)}
              vaults={vaultOptions.filter((v) => v.id !== (editingFolder.vault_id ?? "personal"))}
              onMoveToVault={(vaultId) => handleMoveToVault(editingFolder, vaultId)}
              onCopyToVault={(vaultId) => handleCopyToVault(editingFolder, vaultId)}
            />
          )}
          {!showSnippetPicker && showSerialForm && (
            <SerialConnectionForm ref={serialFormRef} key={`serial-${hostFormSessionKeyRef.current}-${formVersion}`} {...hostFormProps} />
          )}
          {!showSnippetPicker && showForm && !isEditingSerial && (
            <ConnectionForm ref={formRef} key={`${hostFormSessionKeyRef.current}-${formVersion}`} {...hostFormProps} />
          )}
        </>
      }
    >
        <div>
          <HomeToolbar
            search={search}
            onSearchChange={setSearch}
            onCreateHost={() => { if (canCreate) openNew(); }}
            canCreate={canCreate}
            newFolderBlocked={folderBlocked}
            onCreateFolder={createFolder}
            onCreateSerial={canCreate ? () => openNew(true) : undefined}
            onOpenLocalTerminal={() => connectLocal().catch((e) => setError(describeError(e, t)))}
            onOpenSerial={() => connectSerialEphemeral().catch((e) => setError(describeError(e, t)))}
            onOpenImportExport={(mode, opts) => useUIStore.getState().openImportExport(mode, opts)}
            layoutMode={layoutMode}
            onLayoutModeChange={setLayoutMode}
            sortMode={sortMode}
            onSortModeChange={setSortMode}
            availableTags={availableTags}
            tagCounts={tagCounts}
            tagFilter={tagFilter}
            onTagFilterChange={setTagFilter}
            onRenameTag={renameTag}
            onDeleteTag={deleteTag}
          />
        </div>

        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

        {teamCredentialsUnavailable && <TeamCredentialsNote reason={teamCredentialsUnavailable} className="mx-5 mt-3" />}

        <DragSelectSurface
          selectionAreaRef={selectionAreaRef}
          onMouseDown={handleSelectionAreaMouseDown}
          dragBox={dragBox}
          className="flex-1 overflow-y-auto px-9 pt-5 pb-9"
          onClick={() => {
            if (!showForm && !showSerialForm && !editingFolder && !showSnippetPicker) return;
            formRef.current?.flush();
            serialFormRef.current?.flush();
            setShowForm(false);
            setShowSerialForm(false);
            setEditingId(null);
            setEditingFolderId(null);
            setShowSnippetPicker(false);
            setSnippetConnectionIds([]);
          }}
          onContextMenu={(e) => {
            if ((e.target as Element).closest("[data-host-card],[data-folder-card]")) return;
            setSelection([]);
            openBgMenu(e);
          }}
        >
          {scopedConnections.length === 0 && scopedFolders.length === 0 && !showForm && !showSerialForm ? (
            <EmptyState
              icon="lucide:monitor"
              title={t("hosts.page.emptyState.title")}
              body={t("hosts.page.emptyState.subtitle")}
              action={canCreate ? { label: t("hosts.toolbar.newHost"), onClick: () => openNew() } : undefined}
              primary
              links={[
                ...(canCreate ? [{ label: t("hosts.page.emptyState.import"), onClick: () => useUIStore.getState().openImportExport("import") }] : []),
                { label: t("hosts.page.emptyState.quickConnect"), hint: omniHint, onClick: () => useUIStore.getState().setOmniOpen(true) },
              ]}
            />
          ) : (
            <div ref={itemAreaRef} data-drag-surface="true" className="space-y-6">

              {/* ── Sessions live on the user's other devices ── */}
              <RemoteDeviceSessions />

              {/* ── Team Sessions (live multiplayer) ── */}
              <TeamSessions />

              {/* ── Folder breadcrumb (when inside a folder) ── */}
              <FolderBreadcrumb
                path={folderPath}
                rootLabel={t("hosts.page.all")}
                onNavigateToRoot={navigateToRoot}
                onNavigateTo={navigateTo}
              />

              {/* ── Folders section ── */}
              {visibleFolders.length > 0 && (
                <div>
                  <SectionHeader
                    label={t("hosts.page.folders")}
                    count={visibleFolders.length}
                    aside={<SectionAddButton label={t("hosts.page.new")} onClick={createFolder} disabledReason={folderBlocked} />}
                  />
                  <div
                    data-drag-surface="true"
                    {...cardGridProps(layoutMode, "card")}
                  >
                    {visibleFolders.map((folder) => {
                      const canEditFolder = can("EDIT_FOLDERS", folder.vault_id ?? "personal", folder.id);
                      return (
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
                          onRename={(f, newName) => void updateFolder(f.id, { name: newName, object_type: f.object_type, parent_folder_id: f.parent_folder_id, vault_id: f.vault_id })}
                          onDelete={(f) => setConfirmDeleteFolderId(f.id)}
                          onSelect={selectFollowing(handleItemSelect, panelOpen, () => editFolder(folder))}
                          onEdit={() => editFolder(folder)}
                          onExport={() => useUIStore.getState().openImportExport("export", { bulk: { connections: connections.filter((c) => c.folder_id === folder.id).map((c) => c.id) } })}
                          onPointerDown={(e) => handleFolderDragStart(e, folder.id)}
                          {...(canEditFolder ? folderDropProps(folder.id) : {})}
                          vaults={vaultOptions.filter((v) => v.id !== (folder.vault_id ?? "personal"))}
                          canEdit={canEditFolder}
                          onMoveToVault={(vaultId) => handleMoveToVault(folder, vaultId)}
                          onCopyToVault={(vaultId) => handleCopyToVault(folder, vaultId)}
                          bulkContextMenuItems={selectedIdSet.size > 1 ? bulkContextMenuItems : undefined}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Eject drop zone (in DOM whenever inside folder, visible only while dragging) ── */}
              {activeFolderId && can("EDIT_FOLDERS", folderPath[folderPath.length - 1]?.vault_id ?? "personal", folderPath[folderPath.length - 1]?.id) && (
                <FolderEjectZone
                  label={ejectTargetFolderId
                    ? t("hosts.page.ejectMoveTo", { name: folderPath[folderPath.length - 2].name })
                    : t("hosts.page.ejectRemoveFromFolder")}
                  isDragging={isDragging}
                  dragOver={dragOverEject}
                  dropProps={ejectDropProps(ejectTargetFolderId)}
                />
              )}

              {/* ── Pinned section ── */}
              {pinnedHosts.length > 0 && (
                <div>
                  <SectionHeader label={t("hosts.page.pinned")} count={pinnedHosts.length} />
                  <div
                    {...cardGridProps(layoutMode, "wide")}
                  >
                    {pinnedHosts.map(renderHost)}
                  </div>
                </div>
              )}

              {/* ── Hosts section ── */}
              {(mainHosts.length > 0 || showForm || showSerialForm) && (
                <div>
                  <SectionHeader
                    label={t("common.entity.hosts")}
                    count={mainHosts.length}
                    aside={activeFolderId && canCreate && <SectionAddButton label={t("hosts.page.new")} onClick={() => openNew()} />}
                  />
                  <div
                    data-drag-surface="true"
                    {...cardGridProps(layoutMode, "wide")}
                  >
                    {(showForm || showSerialForm) && !editing && <DraftHostCard layout={layoutMode} serial={showSerialForm} />}
                    {mainHosts.map(renderHost)}
                  </div>
                </div>
              )}

              {/* Empty inside folder */}
              {activeFolderId && filtered.length === 0 && !showForm && !showSerialForm && (
                <FolderEmptyState actions={canCreate ? [{ label: t("hosts.toolbar.newHost"), onClick: () => openNew() }] : []} />
              )}

              {/* No search results */}
              {filtered.length === 0 && !showForm && !showSerialForm && connections.length > 0 && searchQuery && (
                <p className="text-sm mt-4 text-(--t-text-dim)">
                  {t("hosts.page.noSearchResults", { search })}
                </p>
              )}
            </div>
          )}
        </DragSelectSurface>

      {bgMenuPos && (
        <ContextMenu
          pos={bgMenuPos}
          onClose={closeBgMenu}
          items={[
            ...(canCreate ? [{ label: t("hosts.toolbar.newHost"), icon: "lucide:server", onClick: () => openNew() } as const] : []),
            ...(canCreate ? [{ label: t("hosts.toolbar.newSerialHost"), icon: "lucide:ethernet-port", onClick: () => openNew(true) } as const] : []),
            { label: t("hosts.toolbar.newFolder"), icon: "lucide:folder-plus", onClick: createFolder, disabledReason: folderBlocked },
            ...(useVaultClipboardStore.getState().clipboard?.tab === "hosts"
              ? [{ label: t("common.action.paste"), icon: "lucide:clipboard", shortcut: getShortcutHint("paste"), onClick: () => window.dispatchEvent(new CustomEvent("voltius:clipboard-paste")) } as const]
              : []),
            ...bgContributions,
          ]}
        />
      )}
    </SidePanelLayout>

      {confirmDeleteIds && (
        <ConfirmModal
          title={t("hosts.page.confirmDelete.title", { count: confirmDeleteIds.length })}
          message={bulkDeleteMessage(confirmDeleteIds)}
          confirmLabel={t("common.action.delete")}
          onConfirm={whenWritable(() => {
            for (const id of confirmDeleteIds) {
              if (scopedFolders.some((f) => f.id === id)) void deleteFolder(id);
              else void deleteConnection(id);
            }
            setSelection([]);
            setConfirmDeleteIds(null);
          })}
          onCancel={() => setConfirmDeleteIds(null)}
        />
      )}

      {confirmDeleteFolderId && (
        <ConfirmModal
          title={t("hosts.page.confirmDeleteFolder.title")}
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

      {crossVaultPaste.pending && (
        <VaultCascadeModal
          cascade={crossVaultPaste.pending}
          onConfirm={crossVaultPaste.accept}
          onCancel={crossVaultPaste.cancel}
        />
      )}

      <ClipboardPill navItem="hosts" />
    </>
  );
}

function DraftHostCard({ layout, serial = false }: { layout: "grid" | "list"; serial?: boolean }) {
  const { t } = useTranslation();
  const icon = serial ? "lucide:ethernet-port" : "lucide:server";
  const label = serial ? t("hosts.toolbar.newSerialHost") : t("hosts.toolbar.newHost");
  if (layout === "list") {
    return (
      <div
        className="flex items-center gap-3 px-4 py-2 rounded-xl"
        style={{ border: "2px dashed var(--t-accent)", opacity: 0.5 }}
      >
        <AvatarTile icon={icon} iconSize={14} className="rounded-lg w-[1.867rem] h-[1.867rem]" iconClassName="text-(--t-text-dim)" />
        <p className="text-sm font-medium-bold text-(--t-text-dim)">{label}</p>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-4 px-4 py-4 rounded-2xl"
      style={{ border: "2px dashed var(--t-accent)", opacity: 0.5 }}
    >
      <AvatarTile icon={icon} iconSize={22} className="rounded-lg w-[3.2rem] h-[3.2rem]" iconClassName="text-(--t-text-dim)" />
      <div>
        <p className="text-base font-medium-bold text-(--t-text-dim)">{label}</p>
        <p className="text-xs mt-0.5 text-(--t-text-dim)">{t("hosts.page.draft.unsaved")}</p>
      </div>
    </div>
  );
}
