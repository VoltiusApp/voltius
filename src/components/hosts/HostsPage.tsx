import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { matchesSearch, compareConnections } from "@/utils/connectionFilter";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Icon } from "@iconify/react";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { useConnectionStore, connectionToFormData } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useUIStore } from "@/stores/uiStore";
import { useFolderStore } from "@/stores/folderStore";
import { storeSecret, getSecret } from "@/services/vault";
import { useUIContributions } from "@/hooks/useUIContributions";
import type { Connection, ConnectionFormData, Folder, SshKey, Identity } from "@/types";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { usePageBulkActions } from "@/hooks/usePageBulkActions";
import { useDragToFolder } from "@/hooks/useDragToFolder";
import { folderDragHandlers } from "@/utils/folderDragHandlers";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { DragSelectSurface } from "@/components/shared/DragSelectSurface";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { VaultCascadeModal } from "@/components/shared/VaultCascadeModal";
import { useVaultCascade } from "@/hooks/useVaultCascade";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useEffectivePinnedPredicate } from "@/hooks/useEffectivePinned";
import { usePermissions } from "@/hooks/usePermission";
import { useAccessibleVaultIds, useScopedVaultId } from "@/hooks/useAccessibleVaultIds";
import { useDefaultVaultId } from "@/hooks/useWritableVaultIds";
import { usePageClipboard } from "@/hooks/usePageClipboard";
import { vaultClipboardBase } from "@/utils/vaultClipboardBase";
import { connectionsClipboardHalf } from "@/services/clipboard/connections";
import { useCrossVaultPasteConfirm } from "@/hooks/useCrossVaultPasteConfirm";
import { ClipboardPill } from "@/components/shared/ClipboardPill";
import { useVaultClipboardStore } from "@/stores/vaultClipboardStore";
import { getShortcutHint } from "@/stores/shortcutStore";
import { clipboardMenuItems } from "@/utils/clipboardMenuItems";
import { FolderCard } from "@/components/folders/FolderCard";

const HOST_GRID_COLS = "repeat(auto-fill, minmax(18rem, 1fr))";
import { FolderEditPanel } from "@/components/folders/FolderEditPanel";
import HostCard from "./HostCard";
import ConnectionForm, { type ConnectionFormHandle } from "@/components/connections/ConnectionForm";
import SerialConnectionForm from "@/components/connections/SerialConnectionForm";
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
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";
import {
  publishConnectionSecrets,
  publishIdentitySecrets,
  publishKeySecrets,
  unpublishIdentitySecrets,
  unpublishKeySecrets,
  withdrawOrWarn,
} from "@/services/vaultObjectSecrets";
import { transferConnectionSecrets } from "@/services/vaultSecrets";
import { saveHostFromForm } from "@/services/hostForm";
import { descendantFolders, itemsInFolderSubtree } from "@/utils/folderTree";
import { folderDeleteMessages } from "@/utils/folderDeleteMessages";
import { useVaultOptions } from "@/hooks/useVaultOptions";
import { useScopedFolders } from "@/hooks/useScopedFolders";
import { FolderBreadcrumb } from "@/components/folders/FolderBreadcrumb";
import { FolderEjectZone } from "@/components/folders/FolderEjectZone";
import { cloneFolderTree, copyFolderSubtree } from "@/utils/folderCopy";
import { moveFolderTreeToVault } from "@/utils/folderMove";


export default function HostsPage() {
  const { t } = useTranslation();
  const { loadConnections, saveConnection, updateConnection, deleteConnection, renameTag, deleteTag } =
    useConnectionStore();
  const connections = useAllConnections();
  const { identities } = useIdentityStore();
  const { keys, updateKey } = useKeyStore();
  const { pending: cascadePending, request: requestCascade, confirm: confirmCascade, cancel: cancelCascade } = useVaultCascade();
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
  const editing = editingId ? (connections.find((c) => c.id === editingId) ?? null) : null;
  const isEditingSerial = editing?.connection_type === "serial";
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!homePendingAction) return;
    if (homePendingAction.action === "create") {
      hostFormSessionKeyRef.current = `new-${Date.now()}`;
      setEditingId(null);
      setShowForm(true);
      setShowSerialForm(false);
      setEditingFolderId(null);
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
  const defaultVaultId = useDefaultVaultId();
  const can = usePermissions();
  const canCreate = selectedVaultIds.some((vid) => can("EDIT_CONNECTIONS", vid));
  const canCreateFolder = selectedVaultIds.some((vid) => can("EDIT_FOLDERS", vid));

  const vaultOptions = useVaultOptions();

  const searchQuery = search.trim().toLowerCase();

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

  const filteredIds = useMemo(
    () => [...visibleFolders.map((f) => f.id), ...filtered.map((c) => c.id)],
    [visibleFolders, filtered],
  );

  const isPinnedFn = useEffectivePinnedPredicate();
  const pinnedHosts = useMemo(
    () => (!searchQuery && !activeFolderId) ? filtered.filter((c) => isPinnedFn(c, "connection")) : [],
    [filtered, searchQuery, activeFolderId, isPinnedFn],
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

  const { focusedId, setFocusedId } = useListKeyNav({
    orderedIds: filteredIds,
    selectedIdSet,
    selectSingle,
    setSelection,
    itemAreaRef,
    layoutMode,
    onEnter: (id) => {
      const folder = visibleFolders.find((f) => f.id === id);
      if (folder) { navigateInto(folder); return; }
      const conn = connections.find((c) => c.id === id);
      if (conn) void handleConnect(conn);
    },
    onEdit: (id) => {
      const conn = connections.find((c) => c.id === id);
      if (conn) { selectSingle(conn.id); openEdit(conn); }
    },
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

  const { vaultForFolder, adapter: clipboardBase } = vaultClipboardBase({
    navItem: "hosts",
    entities: [{ kind: "connection", items: connections }],
    folders: scopedFolders,
    selectedIdSet,
    focusedId,
    activeFolderId,
    scopedVaultId,
    accessibleVaultIds,
    vaultOptions,
    can,
    confirmCrossVault: crossVaultPaste.confirmCrossVault,
    setSelection,
    // Wrapped, not passed: both are declared further down the component.
    migrateFolderTreeToVault: (folder, parentFolderId, vaultId) =>
      migrateFolderTreeToVault(folder, parentFolderId, vaultId),
    moveFolder,
    copyFolderInto: (id, parentFolderId, vaultId, opts) =>
      handleCopyFolderInto(id, parentFolderId, vaultId, opts),
    deleteFolder,
  });

  // Both stores are only filled by a sync or by opening Keychain, and the paste
  // cascade reads them to decide what a host's references need. Empty ones made it
  // decide there was nothing to carry — pasting a host across vaults and silently
  // leaving its key behind, which is exactly what the check exists to prevent.
  useEffect(() => {
    if (keys.length === 0) void useKeyStore.getState().loadKeys();
    if (identities.length === 0) void useIdentityStore.getState().loadIdentities();
  }, []);

  // Owned by the page, not the factory: usePageClipboard dereferences the adapter
  // through a ref, so a store write mid-`applyCascade` can re-render the page and
  // rebuild `connectionsClipboard` before the paste reaches duplicateItems/moveItems.
  // A remap living inside the factory call would be discarded by that re-render.
  const cascadeRemap = useRef<{ identities: Map<string, string>; keys: Map<string, string> }>({
    identities: new Map(),
    keys: new Map(),
  });

  const connectionsClipboard = connectionsClipboardHalf({
    connections,
    keys,
    identities,
    getConnectionsInFolderTree,
    vaultForFolder,
    updateConnection,
    deleteConnection,
    loadConnections,
    moveObjectsToFolder,
    duplicateInto: handleDuplicateInto,
    updateKey,
    saveKey: (form) => useKeyStore.getState().saveKey(form),
    updateIdentity: (id, form) => useIdentityStore.getState().updateIdentity(id, form),
    saveIdentity: (form) => useIdentityStore.getState().saveIdentity(form),
    withdrawOrWarn: (p) => withdrawOrWarn(p as Promise<void>),
  }, cascadeRemap.current);

  // Every mutation below goes through a store method so vault permission checks apply.
  usePageClipboard({
    ...clipboardBase,
    ...connectionsClipboard,
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

  /**
   * Duplicates `conn` into `folderId`, optionally into another vault. `keepName`
   * is for members of a subtree being cloned wholesale — only the root of such a
   * clone carries the "(copy)" suffix. Throws; callers surface the error.
   */
  async function handleDuplicateInto(
    conn: Connection,
    folderId: string | null,
    opts: { vaultId?: string; keepName?: boolean; identityId?: string; keyId?: string } = {},
  ) {
    const newConn = await saveConnection({
      // default name kept in English until all creation sites are localized together (see i18n issue #14)
      name: conn.name ? (opts.keepName ? conn.name : `${conn.name} (copy)`) : undefined,
      connection_type: conn.connection_type,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      auth_type: conn.auth_type,
      tags: [...conn.tags],
      identity_id: opts.identityId ?? conn.identity_id,
      key_id: opts.keyId ?? conn.key_id,
      folder_id: folderId ?? undefined,
      vault_id: opts.vaultId ?? conn.vault_id ?? "personal",
      jump_hosts: conn.jump_hosts ? conn.jump_hosts.map((j) => ({ ...j })) : undefined,
      env_vars: conn.env_vars ? conn.env_vars.map((e) => ({ ...e })) : undefined,
      agent_forwarding: conn.agent_forwarding,
      legacy_algorithms: conn.legacy_algorithms,
      distro: conn.distro,
      icon: conn.icon,
      pinned: conn.pinned,
      ping_disabled: conn.ping_disabled,
      shell_integration: conn.shell_integration,
      keepalive_preset: conn.keepalive_preset,
      persist_session: conn.persist_session,
      ftp_secure: conn.ftp_secure,
      notes: conn.notes,
      serial_port: conn.serial_port,
      serial_baud: conn.serial_baud,
      serial_data_bits: conn.serial_data_bits,
      serial_parity: conn.serial_parity,
      serial_stop_bits: conn.serial_stop_bits,
      serial_flow_control: conn.serial_flow_control,
      serial_auto_reconnect: conn.serial_auto_reconnect,
      pre_command: conn.pre_command,
      post_command: conn.post_command,
      pre_snippet_id: conn.pre_snippet_id,
      post_snippet_id: conn.post_snippet_id,
      ask_vars_each_time: conn.ask_vars_each_time,
      terminal_encoding: conn.terminal_encoding,
    });
    if (newConn && conn.connection_type !== "serial") {
      const pwd = await getSecret(`password:${conn.id}`);
      if (pwd) await storeSecret(`password:${newConn.id}`, pwd);
      if (!conn.key_id) {
        const key = await getSecret(`key:${conn.id}`);
        if (key) await storeSecret(`key:${newConn.id}`, key);
      }
      await publishConnectionSecrets(newConn.id, opts.vaultId ?? conn.vault_id ?? "personal");
    }
    return newConn;
  }

  const handleDuplicate = async (conn: Connection) => {
    try {
      await handleDuplicateInto(conn, conn.folder_id ?? null);
    } catch (err) {
      setError(String(err));
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
    const connectionIds = conns.map((c) => c.id);
    if (connectionIds.length === 0) return;
    setError(null);
    setActiveNav("terminal");
    try {
      const sessionIds = await connectMany(connectionIds);
      if (sessionIds.length > 0) openSessions(sessionIds);
    } catch (err) {
      setError(String(err));
    }
  }, [connectMany, openSessions, setActiveNav]);

  const handleConnect = useCallback(async (conn: Connection) => {
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
    const allCanEdit = selectedConns.every((c) => can("EDIT_CONNECTIONS", c.vault_id ?? "personal"));
    const bulkVaultChildren = (operation: TransferOperation): ContextMenuItem[] => vaultOptions
      .filter((v) => [...selectedConns.map((c) => c.vault_id ?? "personal"), ...selectedFolders.map((f) => f.vault_id ?? "personal")].some((sourceVaultId) => sourceVaultId !== v.id))
      .filter((v) => buildTeamVaultTransferPlan({
        operation,
        targetVaultId: v.id,
        selected: { connectionIds: ids, folderIds },
        can: (permission, vaultId) => can(permission, vaultId),
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
        onClick: () => {
          if (operation === "move") {
            for (const folder of selectedFolders) handleMoveFolderToVault(folder, v.id);
            for (const conn of selectedConns) handleMoveConnectionToVault(conn, v.id);
          } else {
            for (const folder of selectedFolders) handleCopyFolderToVault(folder, v.id);
            for (const conn of selectedConns) handleCopyConnectionToVault(conn, v.id);
          }
        },
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
        label: allSynced ? t("hosts.page.bulk.disableCloudSync", { count: ids.length }) : t("hosts.page.bulk.enableCloudSync", { count: ids.length }),
        icon: allSynced ? "lucide:cloud-off" : "lucide:cloud",
        onClick: () => {
          const store = useSyncPrefsStore.getState();
          for (const c of selectedConns) {
            const isSynced = store.isObjectSynced(c.id, "connection");
            if (allSynced && isSynced) store.toggleExcluded(c.id);
            else if (!allSynced && !isSynced) store.toggleExcluded(c.id);
          }
        },
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
        onClick: () => setConfirmDeleteIds([...ids, ...folderIds]),
        danger: true,
        divider: true,
      },
    ];
  }, [t, selectedIdSet, selectedConnections, selectedFolders, excludedIds, syncTypes, handleDuplicate, can, updateConnection, handleBulkConnect, openSnippetPicker, vaultOptions, connections, identities, keys, scopedFolders]);

  const handleSubmit = async (data: ConnectionFormData, password: string | null, privateKey: string | null, passphrase: string | null) => {
    try {
      const saved = await saveHostFromForm(editing, data, password, privateKey, passphrase, selectedVaultIds[0] ?? "personal");
      if (!editing && saved) setEditingId(saved.id);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleMoveConnectionToVault = (conn: Connection, vaultId: string) => {
    const identity = conn.identity_id ? identities.find((i) => i.id === conn.identity_id) : undefined;
    const key = identity?.key_id ? keys.find((k) => k.id === identity.key_id) : undefined;
    const identityNeedsMove = identity && (identity.vault_id ?? "personal") !== vaultId;
    const keyNeedsMove = key && (key.vault_id ?? "personal") !== vaultId;
    const targetVaultName = vaultOptions.find((v) => v.id === vaultId)?.name ?? vaultId;

    requestCascade({
      operation: "move",
      targetVaultName,
      items: [
        ...(keyNeedsMove ? [{ type: "key" as const, label: key.name ?? "Unnamed key" /* default name kept in English until all creation sites are localized together (see i18n issue #14) */ }] : []),
        ...(identityNeedsMove ? [{ type: "identity" as const, label: identity.name || identity.username }] : []),
      ],
      execute: async () => {
        try {
          if (keyNeedsMove) await updateKey(key.id, { name: key.name, key_type: key.key_type, tags: key.tags, folder_id: key.folder_id, vault_id: vaultId });
          if (identityNeedsMove) await useIdentityStore.getState().updateIdentity(identity.id, { name: identity.name, username: identity.username, key_id: identity.key_id, tags: identity.tags, folder_id: identity.folder_id, vault_id: vaultId });
          await updateConnection(conn.id, {
            name: conn.name, host: conn.host, port: conn.port,
            username: conn.username, auth_type: conn.auth_type, tags: conn.tags,
            identity_id: conn.identity_id, key_id: conn.key_id, folder_id: conn.folder_id, vault_id: vaultId,
            jump_hosts: conn.jump_hosts, env_vars: conn.env_vars, agent_forwarding: conn.agent_forwarding,
            legacy_algorithms: conn.legacy_algorithms,
            pre_command: conn.pre_command, post_command: conn.post_command,
            pre_snippet_id: conn.pre_snippet_id, post_snippet_id: conn.post_snippet_id, ask_vars_each_time: conn.ask_vars_each_time,
            terminal_encoding: conn.terminal_encoding,
            pinned: conn.pinned, ping_disabled: conn.ping_disabled,
            shell_integration: conn.shell_integration,
          });
          await transferConnectionSecrets(conn.id, conn.vault_id ?? "personal", vaultId);
          // The cascade moves the linked key/identity too, so their material has to
          // travel with them — into the destination and out of the source.
          if (keyNeedsMove) {
            await publishKeySecrets(key.id, vaultId);
            await withdrawOrWarn(unpublishKeySecrets(key.id, key.vault_id ?? "personal"));
          }
          if (identityNeedsMove) {
            await publishIdentitySecrets(identity.id, vaultId);
            await withdrawOrWarn(unpublishIdentitySecrets(identity.id, identity.vault_id ?? "personal"));
          }
        } catch (err) { setError(String(err)); }
      },
    });
  };

  const handleCopyConnectionToVault = (conn: Connection, vaultId: string) => {
    const identity = conn.identity_id ? identities.find((i) => i.id === conn.identity_id) : undefined;
    const key = identity?.key_id ? keys.find((k) => k.id === identity.key_id) : undefined;
    const identityNeedsCopy = identity && (identity.vault_id ?? "personal") !== vaultId;
    const keyNeedsCopy = key && (key.vault_id ?? "personal") !== vaultId;
    const targetVaultName = vaultOptions.find((v) => v.id === vaultId)?.name ?? vaultId;

    requestCascade({
      operation: "copy",
      targetVaultName,
      items: [
        ...(keyNeedsCopy ? [{ type: "key" as const, label: key.name ?? "Unnamed key" /* default name kept in English until all creation sites are localized together (see i18n issue #14) */ }] : []),
        ...(identityNeedsCopy ? [{ type: "identity" as const, label: identity.name || identity.username }] : []),
      ],
      execute: async () => {
        try {
          let newKeyId = identity?.key_id;
          let newIdentityId = conn.identity_id;

          if (keyNeedsCopy) {
            const newKey = await useKeyStore.getState().saveKey({ name: key.name, key_type: key.key_type, tags: key.tags, vault_id: vaultId });
            const [priv, pub] = await Promise.all([
              getSecret(`key:${key.id}:private`),
              getSecret(`key:${key.id}:public`),
            ]);
            if (priv) await storeSecret(`key:${newKey.id}:private`, priv);
            if (pub) await storeSecret(`key:${newKey.id}:public`, pub);
            newKeyId = newKey.id;
          }

          if (identityNeedsCopy) {
            const newIdentity = await useIdentityStore.getState().saveIdentity({ name: identity.name, username: identity.username, key_id: newKeyId, tags: identity.tags, vault_id: vaultId });
            const pwd = await getSecret(`identity:${identity.id}:password`);
            if (pwd) await storeSecret(`identity:${newIdentity.id}:password`, pwd);
            newIdentityId = newIdentity.id;
          }

          const destHasConnName = conn.name && connections.some((c) => (c.vault_id ?? "personal") === vaultId && c.name === conn.name);
          const newConn = await saveConnection({
            // default name kept in English until all creation sites are localized together (see i18n issue #14)
            name: conn.name ? (destHasConnName ? `${conn.name} (copy)` : conn.name) : undefined,
            host: conn.host, port: conn.port, username: conn.username,
            auth_type: conn.auth_type, tags: [...conn.tags],
            identity_id: newIdentityId, key_id: conn.key_id, folder_id: conn.folder_id,
            vault_id: vaultId,
          });
          if (newConn) {
            const pwd = await getSecret(`password:${conn.id}`);
            if (pwd) {
              await storeSecret(`password:${newConn.id}`, pwd);
              await saveTeamVaultSecretForVault(vaultId, `password:${newConn.id}`, pwd).catch(() => {});
            }
            if (!conn.key_id) {
              const k = await getSecret(`key:${conn.id}`);
              if (k) {
                await storeSecret(`key:${newConn.id}`, k);
                await saveTeamVaultSecretForVault(vaultId, `key:${newConn.id}`, k).catch(() => {});
              }
            }
          }
        } catch (err) { setError(String(err)); }
      },
    });
  };

  // ── Folder vault move / copy ──────────────────────────────────────────────

  /** Returns all folders in the subtree rooted at folderId (BFS-ordered, parents before children). */
  const getAllSubFolders = (folderId: string): Folder[] => descendantFolders(scopedFolders, folderId);

  /** Returns all connections nested anywhere under folderId. */
  function getConnectionsInFolderTree(folderId: string): Connection[] {
    return itemsInFolderSubtree(connections, scopedFolders, folderId);
  }

  const { folderDeleteMessage, bulkDeleteMessage } = folderDeleteMessages({
    t,
    prefix: "hosts.page",
    folders: scopedFolders,
    itemIdsInFolderTree: (id) => getConnectionsInFolderTree(id).map((c) => c.id),
  });

  const handleMoveFolderToVault = (folder: Folder, vaultId: string) => {
    const subFolders = getAllSubFolders(folder.id);
    const allConns = getConnectionsInFolderTree(folder.id);
    const targetVaultName = vaultOptions.find((v) => v.id === vaultId)?.name ?? vaultId;

    // Collect unique linked identities and keys that need to move
    const identityMap = new Map<string, Identity>();
    const keyMap = new Map<string, SshKey>();
    for (const conn of allConns) {
      const identity = conn.identity_id ? identities.find((i) => i.id === conn.identity_id) : undefined;
      const key = identity?.key_id ? keys.find((k) => k.id === identity.key_id) : undefined;
      if (identity && (identity.vault_id ?? "personal") !== vaultId) identityMap.set(identity.id, identity);
      if (key && (key.vault_id ?? "personal") !== vaultId) keyMap.set(key.id, key);
    }

    const cascadeItems = [
      ...allConns.map((c) => ({ type: "connection" as const, label: c.name ?? c.host })),
      ...[...keyMap.values()].map((k) => ({ type: "key" as const, label: k.name ?? "Unnamed key" /* default name kept in English until all creation sites are localized together (see i18n issue #14) */ })),
      ...[...identityMap.values()].map((i) => ({ type: "identity" as const, label: i.name || i.username })),
    ];

    requestCascade({
      operation: "move",
      targetVaultName,
      description: t("hosts.page.vaultCascade.moveDescription", { folderName: folder.name, targetVaultName }),
      items: cascadeItems,
      execute: async () => {
        try {
          await moveFolderTreeToVault({ root: folder, subFolders, parentFolderId: folder.parent_folder_id ?? null, vaultId, updateFolder });
          for (const key of keyMap.values()) {
            await updateKey(key.id, { name: key.name, key_type: key.key_type, tags: key.tags, folder_id: key.folder_id, vault_id: vaultId });
          }
          for (const identity of identityMap.values()) {
            await useIdentityStore.getState().updateIdentity(identity.id, { name: identity.name, username: identity.username, key_id: identity.key_id, tags: identity.tags, folder_id: identity.folder_id, vault_id: vaultId });
          }
          for (const conn of allConns) {
            await updateConnection(conn.id, { name: conn.name, host: conn.host, port: conn.port, username: conn.username, auth_type: conn.auth_type, tags: conn.tags, identity_id: conn.identity_id, key_id: conn.key_id, folder_id: conn.folder_id, vault_id: vaultId });
          }
        } catch (err) { setError(String(err)); }
      },
    });
  };

  const handleCopyFolderToVault = (folder: Folder, vaultId: string) => {
    const subFolders = getAllSubFolders(folder.id);
    const allConns = getConnectionsInFolderTree(folder.id);
    const targetVaultName = vaultOptions.find((v) => v.id === vaultId)?.name ?? vaultId;

    // Collect unique linked identities/keys that need to be copied (not already in target vault)
    const identityMap = new Map<string, Identity>();
    const keyMap = new Map<string, SshKey>();
    for (const conn of allConns) {
      const identity = conn.identity_id ? identities.find((i) => i.id === conn.identity_id) : undefined;
      const key = identity?.key_id ? keys.find((k) => k.id === identity.key_id) : undefined;
      if (identity && (identity.vault_id ?? "personal") !== vaultId) identityMap.set(identity.id, identity);
      if (key && (key.vault_id ?? "personal") !== vaultId) keyMap.set(key.id, key);
    }

    const cascadeItems = [
      ...allConns.map((c) => ({ type: "connection" as const, label: c.name ?? c.host })),
      ...[...keyMap.values()].map((k) => ({ type: "key" as const, label: k.name ?? "Unnamed key" /* default name kept in English until all creation sites are localized together (see i18n issue #14) */ })),
      ...[...identityMap.values()].map((i) => ({ type: "identity" as const, label: i.name || i.username })),
    ];

    requestCascade({
      operation: "copy",
      targetVaultName,
      description: t("hosts.page.vaultCascade.copyDescription", { folderName: folder.name, targetVaultName }),
      items: cascadeItems,
      execute: async () => {
        try {
          // Create root folder + sub-folders (BFS order ensures parent exists before child)
          const folderIdMap = await copyFolderSubtree({
            root: folder, subFolders, vaultId, existingFolders: folders, saveFolder,
          });
          const newRootId = folderIdMap.get(folder.id)!;

          // Copy keys
          const keyIdMap = new Map<string, string>();
          for (const key of keyMap.values()) {
            const newKey = await useKeyStore.getState().saveKey({ name: key.name, key_type: key.key_type, tags: key.tags, vault_id: vaultId });
            const [priv, pub] = await Promise.all([
              getSecret(`key:${key.id}:private`),
              getSecret(`key:${key.id}:public`),
            ]);
            if (priv) {
              await storeSecret(`key:${newKey.id}:private`, priv);
              await saveTeamVaultSecretForVault(vaultId, `key:${newKey.id}:private`, priv).catch(() => {});
            }
            if (pub) {
              await storeSecret(`key:${newKey.id}:public`, pub);
              await saveTeamVaultSecretForVault(vaultId, `key:${newKey.id}:public`, pub).catch(() => {});
            }
            keyIdMap.set(key.id, newKey.id);
          }

          // Copy identities
          const identityIdMap = new Map<string, string>();
          for (const identity of identityMap.values()) {
            const newKeyId = identity.key_id ? (keyIdMap.get(identity.key_id) ?? identity.key_id) : undefined;
            const newIdentity = await useIdentityStore.getState().saveIdentity({ name: identity.name, username: identity.username, key_id: newKeyId, tags: identity.tags, vault_id: vaultId });
            const pwd = await getSecret(`identity:${identity.id}:password`);
            if (pwd) {
              await storeSecret(`identity:${newIdentity.id}:password`, pwd);
              await saveTeamVaultSecretForVault(vaultId, `identity:${newIdentity.id}:password`, pwd).catch(() => {});
            }
            identityIdMap.set(identity.id, newIdentity.id);
          }

          // Copy connections
          for (const conn of allConns) {
            const newIdentityId = conn.identity_id ? (identityIdMap.get(conn.identity_id) ?? conn.identity_id) : undefined;
            const newFolderId = conn.folder_id ? (folderIdMap.get(conn.folder_id) ?? newRootId) : newRootId;
            const newKeyId = conn.key_id ? (keyIdMap.get(conn.key_id) ?? conn.key_id) : undefined;
            const newConn = await saveConnection({ name: conn.name, host: conn.host, port: conn.port, username: conn.username, auth_type: conn.auth_type, tags: [...conn.tags], identity_id: newIdentityId, key_id: newKeyId, folder_id: newFolderId, vault_id: vaultId });
            if (newConn) {
              const pwd = await getSecret(`password:${conn.id}`);
              if (pwd) {
                await storeSecret(`password:${newConn.id}`, pwd);
                await saveTeamVaultSecretForVault(vaultId, `password:${newConn.id}`, pwd).catch(() => {});
              }
              if (!conn.key_id) {
                const k = await getSecret(`key:${conn.id}`);
                if (k) {
                  await storeSecret(`key:${newConn.id}`, k);
                  await saveTeamVaultSecretForVault(vaultId, `key:${newConn.id}`, k).catch(() => {});
                }
              }
            }
          }
        } catch (err) { setError(String(err)); }
      },
    });
  };

  /** Deep-clones a folder subtree under `parentFolderId`, into `vaultId` when given. */
  const handleCopyFolderInto = async (
    folderId: string,
    parentFolderId: string | null,
    vaultId?: string,
    opts: { keepName?: boolean } = {},
  ) => {
    const folder = scopedFolders.find((f) => f.id === folderId);
    if (!folder) throw new Error(`Unknown folder ${folderId}`);
    const targetVaultId = vaultId ?? folder.vault_id;
    const { root, folderIdMap } = await cloneFolderTree({
      root: folder,
      subFolders: getAllSubFolders(folder.id),
      parentFolderId,
      vaultId: targetVaultId,
      keepName: opts.keepName ?? false,
      saveFolder,
    });
    for (const conn of getConnectionsInFolderTree(folder.id)) {
      await handleDuplicateInto(conn, folderIdMap.get(conn.folder_id ?? "") ?? root.id, {
        vaultId: targetVaultId,
        keepName: true,
      });
    }
    return root;
  };

  /**
   * Moves a folder subtree into `vaultId`, reparenting the root at the same time.
   * Same updateFolder/updateConnection path handleMoveFolderToVault uses, so the
   * team-vault migration logic in the stores applies.
   */
  const migrateFolderTreeToVault = async (
    folder: Folder,
    parentFolderId: string | null,
    vaultId: string,
  ) => {
    await moveFolderTreeToVault({ root: folder, subFolders: getAllSubFolders(folder.id), parentFolderId, vaultId, updateFolder });
    for (const conn of getConnectionsInFolderTree(folder.id)) {
      const from = conn.vault_id ?? "personal";
      await updateConnection(conn.id, { ...connectionToFormData(conn), vault_id: vaultId });
      await transferConnectionSecrets(conn.id, from, vaultId);
    }
  };

  // ── Drag-to-folder ────────────────────────────────────────────────────────

  // Per-folder item counts
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of connections) {
      if (c.folder_id) counts[c.folder_id] = (counts[c.folder_id] ?? 0) + 1;
    }
    return counts;
  }, [connections]);

  return (
    <>
    <SidePanelLayout
      panelOpen={showForm || showSerialForm || editingFolder !== null || showSnippetPicker}
      panelWidth={showSnippetPicker ? 300 : editingFolder !== null ? 280 : 320}
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
              onUpdate={(id, data) => void updateFolder(id, data)}
              onDelete={(f) => setConfirmDeleteFolderId(f.id)}
              onExport={() => useUIStore.getState().openImportExport("export", { bulk: { connections: connections.filter((c) => c.folder_id === editingFolder.id).map((c) => c.id) } })}
              onClose={() => setEditingFolderId(null)}
              vaults={vaultOptions.filter((v) => v.id !== (editingFolder.vault_id ?? "personal"))}
              canEdit={can("EDIT_CONNECTIONS", editingFolder.vault_id ?? "personal")}
              onMoveToVault={(vaultId) => handleMoveFolderToVault(editingFolder, vaultId)}
              onCopyToVault={(vaultId) => handleCopyFolderToVault(editingFolder, vaultId)}
            />
          )}
          {!showSnippetPicker && showSerialForm && (
            <SerialConnectionForm
              ref={serialFormRef}
              key={`serial-${hostFormSessionKeyRef.current}-${formVersion}`}
              initial={editing ?? undefined}
              onSubmit={handleSubmit}
              onClose={() => { setShowSerialForm(false); setEditingId(null); }}
              onDuplicate={editing ? () => handleDuplicate(editing) : undefined}
              onConnect={editing ? () => void handleConnect(editing) : undefined}
              onDelete={editing ? () => { deleteConnection(editing.id); setShowSerialForm(false); setEditingId(null); } : undefined}
              vaults={editing ? vaultOptions.filter((v) => v.id !== (editing.vault_id ?? "personal")) : []}
              canEdit={editing ? can("EDIT_CONNECTIONS", editing.vault_id ?? "personal") : false}
              onMoveToVault={editing ? (vaultId) => { void handleMoveConnectionToVault(editing, vaultId); } : undefined}
              onCopyToVault={editing ? (vaultId) => { void handleCopyConnectionToVault(editing, vaultId); } : undefined}
            />
          )}
          {!showSnippetPicker && showForm && !isEditingSerial && (
            <ConnectionForm
              ref={formRef}
              key={`${hostFormSessionKeyRef.current}-${formVersion}`}
              initial={editing ?? undefined}
              onSubmit={handleSubmit}
              onClose={() => { setShowForm(false); setEditingId(null); }}
              onDuplicate={editing ? () => handleDuplicate(editing) : undefined}
              onConnect={editing ? () => void handleConnect(editing) : undefined}
              onDelete={editing ? () => { deleteConnection(editing.id); setShowForm(false); setEditingId(null); } : undefined}
              vaults={editing ? vaultOptions.filter((v) => v.id !== (editing.vault_id ?? "personal")) : []}
              canEdit={editing ? can("EDIT_CONNECTIONS", editing.vault_id ?? "personal") : false}
              onMoveToVault={editing ? (vaultId) => { void handleMoveConnectionToVault(editing, vaultId); } : undefined}
              onCopyToVault={editing ? (vaultId) => { void handleCopyConnectionToVault(editing, vaultId); } : undefined}
            />
          )}
        </>
      }
    >
        <div>
          <HomeToolbar
            search={search}
            onSearchChange={setSearch}
            onCreateHost={() => {
              if (!canCreate) return;
              hostFormSessionKeyRef.current = `new-${Date.now()}`;
              setEditingId(null);
              setShowForm(true);
              setShowSerialForm(false);
              setEditingFolderId(null);
            }}
            canCreate={canCreate}
            canCreateFolder={canCreateFolder}
            onCreateFolder={() => void saveFolder({ name: "New Folder" /* persisted English default; menu label is localized */, object_type: "connection", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }).then((f) => { setShowForm(false); setShowSerialForm(false); setEditingId(null); setEditingFolderId(f.id); })}
            onCreateSerial={canCreate ? () => {
              hostFormSessionKeyRef.current = `new-${Date.now()}`;
              setEditingId(null);
              setShowSerialForm(true);
              setShowForm(false);
              setEditingFolderId(null);
            } : undefined}
            onOpenLocalTerminal={() => connectLocal().catch((e) => setError(String(e)))}
            onOpenSerial={() => connectSerialEphemeral().catch((e) => setError(String(e)))}
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
          {connections.length === 0 && !showForm && !showSerialForm ? (
            <EmptyState onAdd={canCreate ? () => { setShowForm(true); setShowSerialForm(false); setEditingFolderId(null); } : undefined} />
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
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
                      {t("hosts.page.folders")}
                    </p>
                    {canCreateFolder && <button
                      className="flex items-center gap-1 text-xs transition-colors px-2 py-1 rounded-lg text-(--t-text-dim)"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "var(--t-text-primary)";
                        e.currentTarget.style.background = "var(--t-bg-elevated)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "var(--t-text-dim)";
                        e.currentTarget.style.background = "transparent";
                      }}
                      onClick={() =>
                        saveFolder({ name: "New Folder" /* persisted English default */, object_type: "connection", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }).then((f) => {
                          setShowForm(false); setEditingId(null); setEditingFolderId(f.id);
                        })
                      }
                    >
                      <Icon icon="lucide:plus" width={12} />
                      {t("hosts.page.new")}
                    </button>}
                  </div>
                  <div
                    data-drag-surface="true"
                    className={layoutMode === "grid" ? "grid gap-4" : "flex flex-col gap-1"}
                    style={layoutMode === "grid" ? { gridTemplateColumns: HOST_GRID_COLS } : undefined}
                  >
                    {visibleFolders.map((folder) => {
                      const canEditFolder = can("EDIT_FOLDERS", folder.vault_id ?? "personal");
                      return (
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
                          onRename={(f, newName) => void updateFolder(f.id, { name: newName, object_type: f.object_type, parent_folder_id: f.parent_folder_id, vault_id: f.vault_id })}
                          onDelete={(f) => setConfirmDeleteFolderId(f.id)}
                          onSelect={(id) => { if (!selectedIdSet.has(id)) selectSingle(id); }}
                          onEdit={() => { setShowForm(false); setEditingId(null); setEditingFolderId(folder.id); }}
                          onExport={() => useUIStore.getState().openImportExport("export", { bulk: { connections: connections.filter((c) => c.folder_id === folder.id).map((c) => c.id) } })}
                          onPointerDown={(e) => handleFolderDragStart(e, folder.id)}
                          {...(canEditFolder ? folderDropProps(folder.id) : {})}
                          vaults={vaultOptions.filter((v) => v.id !== (folder.vault_id ?? "personal"))}
                          canEdit={canEditFolder}
                          onMoveToVault={(vaultId) => handleMoveFolderToVault(folder, vaultId)}
                          onCopyToVault={(vaultId) => handleCopyFolderToVault(folder, vaultId)}
                          bulkContextMenuItems={selectedIdSet.size > 1 ? bulkContextMenuItems : undefined}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Eject drop zone (in DOM whenever inside folder, visible only while dragging) ── */}
              {activeFolderId && can("EDIT_FOLDERS", folderPath[folderPath.length - 1]?.vault_id ?? "personal") && (
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
                <div className="mb-6">
                  <p className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">{t("hosts.page.pinned")}</p>
                  <div
                    className={layoutMode === "grid" ? "grid gap-4" : "flex flex-col gap-1"}
                    style={layoutMode === "grid" ? { gridTemplateColumns: HOST_GRID_COLS } : undefined}
                  >
                    {pinnedHosts.map((conn) => {
                      const connVaultId = conn.vault_id ?? "personal";
                      const canEdit = can("EDIT_CONNECTIONS", connVaultId);
                      const otherVaults = vaultOptions.filter((v) => v.id !== connVaultId);
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
                          canEdit={canEdit}
                          vaults={otherVaults}
                          onSelect={(id, e) => {
                            handleItemSelect(id, e);
                            if (showForm) {
                              const c = connections.find((c) => c.id === id);
                              if (c) setEditingId(c.id);
                            }
                          }}
                          onConnect={handleConnect}
                          onEdit={(c) => { selectSingle(c.id); openEdit(c); }}
                          onDuplicate={handleDuplicate}
                          onExecuteSnippet={(c) => openSnippetPicker([c.id])}
                          onDelete={handleDeleteConnection}
                          onMoveToVault={handleMoveConnectionToVault}
                          onCopyToVault={handleCopyConnectionToVault}
                          bulkContextMenuItems={shouldUseBulkHostContextMenu(selectedConnections.length) ? bulkContextMenuItems : undefined}
                          onPointerDown={(e) => handleDragStart(e, conn.id)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Hosts section ── */}
              {(filtered.length > 0 || showForm || showSerialForm) && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
                      {t("common.entity.hosts")}
                    </p>
                    {activeFolderId && (
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
                        onClick={() => { if (canCreate) { hostFormSessionKeyRef.current = `new-${Date.now()}`; setEditingId(null); setShowForm(true); setShowSerialForm(false); setEditingFolderId(null); } }}
                        disabled={!canCreate}
                        style={{ opacity: !canCreate ? 0.35 : undefined }}
                      >
                        <Icon icon="lucide:plus" width={12} />
                        {t("hosts.page.new")}
                      </button>
                    )}
                  </div>
                  <div
                    data-drag-surface="true"
                    className={layoutMode === "grid" ? "grid gap-4" : "flex flex-col gap-1"}
                    style={layoutMode === "grid" ? { gridTemplateColumns: HOST_GRID_COLS } : undefined}
                  >
                    {(showForm || showSerialForm) && !editing && <DraftHostCard layout={layoutMode} serial={showSerialForm} />}
                    {filtered.map((conn) => {
                      const connVaultId = conn.vault_id ?? "personal";
                      const canEdit = can("EDIT_CONNECTIONS", connVaultId);
                      const otherVaults = vaultOptions.filter((v) => v.id !== connVaultId);
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
                          canEdit={canEdit}
                          vaults={otherVaults}
                          onSelect={(id, e) => {
                            handleItemSelect(id, e);
                            if (showForm) {
                              const c = connections.find((c) => c.id === id);
                              if (c) setEditingId(c.id);
                            }
                          }}
                          onConnect={handleConnect}
                          onEdit={(c) => { selectSingle(c.id); openEdit(c); }}
                          onDuplicate={handleDuplicate}
                          onExecuteSnippet={(c) => openSnippetPicker([c.id])}
                          onDelete={handleDeleteConnection}
                          onMoveToVault={handleMoveConnectionToVault}
                          onCopyToVault={handleCopyConnectionToVault}
                          bulkContextMenuItems={shouldUseBulkHostContextMenu(selectedConnections.length) ? bulkContextMenuItems : undefined}
                          onPointerDown={(e) => handleDragStart(e, conn.id)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty inside folder */}
              {activeFolderId && filtered.length === 0 && !showForm && !showSerialForm && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Icon icon="lucide:folder-open" width={32} className="text-(--t-text-dim)" />
                  <p className="text-sm text-(--t-text-dim)">{t("hosts.page.folderEmpty")}</p>
                  <button
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-(--t-bg-elevated) text-(--t-accent) border border-(--t-border-hover)"
                    onClick={() => { hostFormSessionKeyRef.current = `new-${Date.now()}`; setEditingId(null); setShowForm(true); setShowSerialForm(false); setEditingFolderId(null); }}
                  >
                    <Icon icon="lucide:plus" width={12} />
                    {t("hosts.page.addHost")}
                  </button>
                </div>
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
            ...(canCreate ? [{ label: t("hosts.toolbar.newHost"), icon: "lucide:server", onClick: () => { hostFormSessionKeyRef.current = `new-${Date.now()}`; setEditingId(null); setShowForm(true); setShowSerialForm(false); setEditingFolderId(null); } } as const] : []),
            ...(canCreate ? [{ label: t("hosts.toolbar.newSerialHost"), icon: "lucide:ethernet-port", onClick: () => { hostFormSessionKeyRef.current = `new-${Date.now()}`; setEditingId(null); setShowSerialForm(true); setShowForm(false); setEditingFolderId(null); } } as const] : []),
            ...(canCreateFolder ? [{ label: t("hosts.toolbar.newFolder"), icon: "lucide:folder-plus", onClick: () => void saveFolder({ name: "New Folder" /* persisted English default */, object_type: "connection", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }).then((f) => { setShowForm(false); setEditingId(null); setEditingFolderId(f.id); }) } as const] : []),
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
          onConfirm={() => {
            for (const id of confirmDeleteIds) {
              if (scopedFolders.some((f) => f.id === id)) void deleteFolder(id);
              else void deleteConnection(id);
            }
            setSelection([]);
            setConfirmDeleteIds(null);
          }}
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

      {cascadePending && (
        <VaultCascadeModal
          cascade={cascadePending}
          onConfirm={() => { void confirmCascade(); }}
          onCancel={cancelCascade}
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

function EmptyState({ onAdd }: { onAdd?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[320px] gap-5">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center bg-(--t-bg-toolbar) border border-(--t-border)"
      >
        <Icon icon="lucide:monitor" width={28} className="text-(--t-text-dim)" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium mb-1 text-(--t-text-primary)">{t("hosts.page.emptyState.title")}</p>
        <p className="text-xs text-(--t-text-dim)">{t("hosts.page.emptyState.subtitle")}</p>
      </div>
      {onAdd && <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-(--t-bg-elevated) text-(--t-accent) border border-(--t-border-hover)"
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-border-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
      >
        <Icon icon="lucide:plus" width={14} />
        {t("hosts.page.addHost")}
      </button>}
    </div>
  );
}
