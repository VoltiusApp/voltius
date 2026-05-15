import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchesSearch, compareConnections } from "@/utils/connectionFilter";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { Icon } from "@iconify/react";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useUIStore } from "@/stores/uiStore";
import { useFolderStore } from "@/stores/folderStore";
import { storeSecret, deleteSecret, getSecret } from "@/services/vault";
import { useUIContributions } from "@/hooks/useUIContributions";
import type { Connection, ConnectionFormData, VaultOption, Folder, SshKey, Identity } from "@/types";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { useDragToFolder } from "@/hooks/useDragToFolder";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { DragSelectSurface } from "@/components/shared/DragSelectSurface";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { VaultCascadeModal } from "@/components/shared/VaultCascadeModal";
import { useVaultCascade } from "@/hooks/useVaultCascade";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { usePermissions } from "@/hooks/usePermission";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { useDefaultVaultId } from "@/hooks/useWritableVaultIds";
import { FolderCard } from "@/components/folders/FolderCard";

const HOST_GRID_COLS = "repeat(auto-fill, minmax(18rem, 1fr))";
import { FolderEditPanel } from "@/components/folders/FolderEditPanel";
import HostCard from "./HostCard";
import ConnectionForm, { type ConnectionFormHandle } from "@/components/connections/ConnectionForm";
import SerialConnectionForm from "@/components/connections/SerialConnectionForm";
import { HomeToolbar } from "./HostsToolbar";
import { TeamSessions } from "./TeamSessions";
import { SidePanelLayout } from "@/components/shared/SidePanelLayout";
import { useSyncedFormKey } from "@/hooks/useSyncedFormKey";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useAllFolders } from "@/hooks/useAllFolders";
import { SnippetPickerPanel } from "./SnippetPickerPanel";
import { getHostDeleteTargetIds, shouldUseBulkHostContextMenu } from "./hostSelection";
import { buildTeamVaultTransferPlan, type TransferOperation } from "@/services/teamVaultPermissions";
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";


export default function HostsPage() {
  const { loadConnections, saveConnection, updateConnection, deleteConnection, renameTag, deleteTag } =
    useConnectionStore();
  const connections = useAllConnections();
  const { identities } = useIdentityStore();
  const { keys, updateKey } = useKeyStore();
  const { pending: cascadePending, request: requestCascade, confirm: confirmCascade, cancel: cancelCascade } = useVaultCascade();
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
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const accessibleVaultIds = useAccessibleVaultIds();
  const defaultVaultId = useDefaultVaultId();
  const can = usePermissions();
  const canCreate = selectedVaultIds.some((vid) => can("EDIT_CONNECTIONS", vid));
  const canCreateFolder = selectedVaultIds.some((vid) => can("EDIT_FOLDERS", vid));

  const vaultOptions = useMemo<VaultOption[]>(() => {
    const linkedTeamIds = new Set(vaults.map((v) => v.teamId).filter(Boolean));
    return [
      { id: "personal", name: "Personal" },
      ...vaults.filter((v) => v.id !== "personal").map((v) => ({ id: v.teamId ?? v.id, name: v.name })),
      ...teams.filter((t) => !linkedTeamIds.has(t.id)).map((t) => ({ id: t.id, name: t.name })),
    ];
  }, [vaults, teams]);

  const searchQuery = search.trim().toLowerCase();

  const availableTags = useMemo(
    () => [...new Set(connections.flatMap((c) => c.tags))].sort(),
    [connections],
  );

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of connections) {
      for (const t of c.tags) counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }, [connections]);

  const scopedFolders = useMemo(() => folders.filter((f) => f.object_type === "connection"), [folders]);
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

  const pinnedHosts = useMemo(
    () => (!searchQuery && !activeFolderId) ? filtered.filter((c) => c.pinned) : [],
    [filtered, searchQuery, activeFolderId],
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

  useEffect(() => {
    const handler = () => {
      if (useUIStore.getState().activeNav !== "hosts") return;
      if (selectedIdSet.size > 0) setConfirmDeleteIds([...selectedIdSet]);
    };
    window.addEventListener("voltius:delete", handler);
    return () => window.removeEventListener("voltius:delete", handler);
  }, [selectedIdSet]);

  // ── Drag-to-folder ────────────────────────────────────────────────────────

  const visibleFolderIds = useMemo(() => new Set(visibleFolders.map((f) => f.id)), [visibleFolders]);

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
      try {
        await moveObjectsToFolder(ids, "connection", folderId);
        await loadConnections();
      } catch (err) { setError(String(err)); }
    },
    onEject: async (ids, targetFolderId) => {
      try {
        await moveObjectsToFolder(ids, "connection", targetFolderId);
        await loadConnections();
      } catch (err) { setError(String(err)); }
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

  const handleDuplicate = async (conn: Connection) => {
    try {
      const newConn = await saveConnection({
        name: conn.name ? `${conn.name} (copy)` : undefined,
        connection_type: conn.connection_type,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        auth_type: conn.auth_type,
        tags: [...conn.tags],
        identity_id: conn.identity_id,
        folder_id: conn.folder_id,
        vault_id: conn.vault_id ?? "personal",
        serial_port: conn.serial_port,
        serial_baud: conn.serial_baud,
        serial_data_bits: conn.serial_data_bits,
        serial_parity: conn.serial_parity,
        serial_stop_bits: conn.serial_stop_bits,
        serial_flow_control: conn.serial_flow_control,
        pre_command: conn.pre_command,
        post_command: conn.post_command,
        terminal_encoding: conn.terminal_encoding,
      });
      if (newConn && conn.connection_type !== "serial") {
        const pwd = await getSecret(`password:${conn.id}`).catch(() => null);
        const key = await getSecret(`key:${conn.id}`).catch(() => null);
        if (pwd) await storeSecret(`password:${newConn.id}`, pwd);
        if (key) await storeSecret(`key:${newConn.id}`, key);
      }
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
    setActiveNav("terminal" as any);
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
    setActiveNav("terminal" as any);
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
        label: `Execute Snippet on ${ids.length} host${ids.length === 1 ? "" : "s"}`,
        icon: "lucide:braces",
        onClick: () => openSnippetPicker(ids),
        divider: true,
      },
      ...(selectedConns.length > 1 ? [{
        label: `Connect ${selectedConns.length} hosts`,
        icon: "lucide:terminal",
        onClick: () => { void handleBulkConnect(selectedConns); },
        divider: true,
      }] : []),
      ...(allCanEdit ? [{
        label: `Duplicate ${ids.length} hosts`,
        icon: "lucide:copy",
        onClick: () => { void Promise.all(selectedConns.map((c) => handleDuplicate(c))); },
      }] : []),
      ...(moveChildren.length > 0 ? [{
        label: `Move ${totalSelected} item${totalSelected === 1 ? "" : "s"} to`,
        icon: "lucide:vault",
        children: moveChildren,
        divider: true,
      }] : []),
      ...(copyChildren.length > 0 ? [{
        label: `Copy ${totalSelected} item${totalSelected === 1 ? "" : "s"} to`,
        icon: "lucide:copy-plus",
        children: copyChildren,
      }] : []),
      {
        label: allSynced ? `Disable cloud sync (${ids.length})` : `Enable cloud sync (${ids.length})`,
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
        label: selectedConns.every((c) => c.ping_disabled) ? `Enable reachability check (${ids.length})` : `Disable reachability check (${ids.length})`,
        icon: selectedConns.every((c) => c.ping_disabled) ? "lucide:wifi" : "lucide:wifi-off",
        onClick: () => {
          const allDisabled = selectedConns.every((c) => c.ping_disabled);
          void Promise.all(selectedConns.map((c) => updateConnection(c.id, { name: c.name, host: c.host, port: c.port, username: c.username, auth_type: c.auth_type, tags: c.tags, identity_id: c.identity_id, folder_id: c.folder_id, vault_id: c.vault_id, jump_hosts: c.jump_hosts, env_vars: c.env_vars, agent_forwarding: c.agent_forwarding, pre_command: c.pre_command, post_command: c.post_command, terminal_encoding: c.terminal_encoding, pinned: c.pinned, ping_disabled: !allDisabled })));
        },
      },
      {
        label: `Export ${ids.length} hosts`,
        icon: "lucide:upload",
        onClick: () => useUIStore.getState().openImportExport("export", { connectionIds: ids }),
      },
      {
        label: `Delete ${totalSelected} item${totalSelected === 1 ? "" : "s"}`,
        icon: "lucide:trash-2",
        onClick: () => setConfirmDeleteIds([...ids, ...folderIds]),
        danger: true,
        divider: true,
      },
    ];
  }, [selectedIdSet, selectedConnections, selectedFolders, excludedIds, syncTypes, handleDuplicate, can, updateConnection, handleBulkConnect, openSnippetPicker, vaultOptions, connections, identities, keys, scopedFolders]);

  const handleSubmit = async (data: ConnectionFormData, password: string | null, privateKey: string | null) => {
    try {
      if (editing) {
        await updateConnection(editing.id, data);
        if (password !== null) {
          const localKey = `password:${editing.id}`;
          if (password) {
            await storeSecret(localKey, password);
            await saveTeamVaultSecretForVault(data.vault_id ?? editing.vault_id, localKey, password).catch(() => {});
          } else await deleteSecret(localKey).catch(() => {});
        }
        if (privateKey !== null) {
          const localKey = `key:${editing.id}`;
          if (privateKey) {
            await storeSecret(localKey, privateKey);
            await saveTeamVaultSecretForVault(data.vault_id ?? editing.vault_id, localKey, privateKey).catch(() => {});
          } else await deleteSecret(localKey).catch(() => {});
        }
      } else {
        const conn = await saveConnection({ ...data, vault_id: data.vault_id ?? selectedVaultIds[0] ?? "personal" });
        if (password && conn) {
          const localKey = `password:${conn.id}`;
          await storeSecret(localKey, password);
          await saveTeamVaultSecretForVault(conn.vault_id, localKey, password).catch(() => {});
        }
        if (privateKey && conn) {
          const localKey = `key:${conn.id}`;
          await storeSecret(localKey, privateKey);
          await saveTeamVaultSecretForVault(conn.vault_id, localKey, privateKey).catch(() => {});
        }
        if (conn) setEditingId(conn.id);
      }
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
        ...(keyNeedsMove ? [{ type: "key" as const, label: key.name ?? "Unnamed key" }] : []),
        ...(identityNeedsMove ? [{ type: "identity" as const, label: identity.name || identity.username }] : []),
      ],
      execute: async () => {
        try {
          if (keyNeedsMove) await updateKey(key.id, { name: key.name, key_type: key.key_type, tags: key.tags, folder_id: key.folder_id, vault_id: vaultId });
          if (identityNeedsMove) await useIdentityStore.getState().updateIdentity(identity.id, { name: identity.name, username: identity.username, key_id: identity.key_id, tags: identity.tags, folder_id: identity.folder_id, vault_id: vaultId });
          await updateConnection(conn.id, {
            name: conn.name, host: conn.host, port: conn.port,
            username: conn.username, auth_type: conn.auth_type, tags: conn.tags,
            identity_id: conn.identity_id, folder_id: conn.folder_id, vault_id: vaultId,
          });
          const pwd = await getSecret(`password:${conn.id}`).catch(() => null);
          const k = await getSecret(`key:${conn.id}`).catch(() => null);
          if (pwd) await saveTeamVaultSecretForVault(vaultId, `password:${conn.id}`, pwd).catch(() => {});
          if (k) await saveTeamVaultSecretForVault(vaultId, `key:${conn.id}`, k).catch(() => {});
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
        ...(keyNeedsCopy ? [{ type: "key" as const, label: key.name ?? "Unnamed key" }] : []),
        ...(identityNeedsCopy ? [{ type: "identity" as const, label: identity.name || identity.username }] : []),
      ],
      execute: async () => {
        try {
          let newKeyId = identity?.key_id;
          let newIdentityId = conn.identity_id;

          if (keyNeedsCopy) {
            const newKey = await useKeyStore.getState().saveKey({ name: key.name, key_type: key.key_type, tags: key.tags, vault_id: vaultId });
            const [priv, pub] = await Promise.all([
              getSecret(`key:${key.id}:private`).catch(() => null),
              getSecret(`key:${key.id}:public`).catch(() => null),
            ]);
            if (priv) await storeSecret(`key:${newKey.id}:private`, priv);
            if (pub) await storeSecret(`key:${newKey.id}:public`, pub);
            newKeyId = newKey.id;
          }

          if (identityNeedsCopy) {
            const newIdentity = await useIdentityStore.getState().saveIdentity({ name: identity.name, username: identity.username, key_id: newKeyId, tags: identity.tags, vault_id: vaultId });
            const pwd = await getSecret(`identity:${identity.id}:password`).catch(() => null);
            if (pwd) await storeSecret(`identity:${newIdentity.id}:password`, pwd);
            newIdentityId = newIdentity.id;
          }

          const destHasConnName = conn.name && connections.some((c) => (c.vault_id ?? "personal") === vaultId && c.name === conn.name);
          const newConn = await saveConnection({
            name: conn.name ? (destHasConnName ? `${conn.name} (copy)` : conn.name) : undefined,
            host: conn.host, port: conn.port, username: conn.username,
            auth_type: conn.auth_type, tags: [...conn.tags],
            identity_id: newIdentityId, folder_id: conn.folder_id,
            vault_id: vaultId,
          });
          if (newConn) {
            const pwd = await getSecret(`password:${conn.id}`).catch(() => null);
            const k = await getSecret(`key:${conn.id}`).catch(() => null);
            if (pwd) {
              await storeSecret(`password:${newConn.id}`, pwd);
              await saveTeamVaultSecretForVault(vaultId, `password:${newConn.id}`, pwd).catch(() => {});
            }
            if (k) {
              await storeSecret(`key:${newConn.id}`, k);
              await saveTeamVaultSecretForVault(vaultId, `key:${newConn.id}`, k).catch(() => {});
            }
          }
        } catch (err) { setError(String(err)); }
      },
    });
  };

  // ── Folder vault move / copy ──────────────────────────────────────────────

  /** Returns all folders in the subtree rooted at folderId (BFS-ordered, parents before children). */
  const getAllSubFolders = (folderId: string): Folder[] => {
    const queue = [folderId];
    const result: Folder[] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      const children = scopedFolders.filter((f) => f.parent_folder_id === cur);
      result.push(...children);
      queue.push(...children.map((f) => f.id));
    }
    return result;
  };

  /** Returns all connections nested anywhere under folderId. */
  const getConnectionsInFolderTree = (folderId: string): Connection[] => {
    const folderIds = new Set([folderId, ...getAllSubFolders(folderId).map((f) => f.id)]);
    return connections.filter((c) => c.folder_id != null && folderIds.has(c.folder_id));
  };

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
      ...[...keyMap.values()].map((k) => ({ type: "key" as const, label: k.name ?? "Unnamed key" })),
      ...[...identityMap.values()].map((i) => ({ type: "identity" as const, label: i.name || i.username })),
    ];

    requestCascade({
      operation: "move",
      targetVaultName,
      description: `Moving "${folder.name}" will also move the following items to ${targetVaultName}:`,
      items: cascadeItems,
      execute: async () => {
        try {
          await updateFolder(folder.id, { name: folder.name, object_type: folder.object_type, parent_folder_id: folder.parent_folder_id, vault_id: vaultId });
          for (const sf of subFolders) {
            await updateFolder(sf.id, { name: sf.name, object_type: sf.object_type, parent_folder_id: sf.parent_folder_id, vault_id: vaultId });
          }
          for (const key of keyMap.values()) {
            await updateKey(key.id, { name: key.name, key_type: key.key_type, tags: key.tags, folder_id: key.folder_id, vault_id: vaultId });
          }
          for (const identity of identityMap.values()) {
            await useIdentityStore.getState().updateIdentity(identity.id, { name: identity.name, username: identity.username, key_id: identity.key_id, tags: identity.tags, folder_id: identity.folder_id, vault_id: vaultId });
          }
          for (const conn of allConns) {
            await updateConnection(conn.id, { name: conn.name, host: conn.host, port: conn.port, username: conn.username, auth_type: conn.auth_type, tags: conn.tags, identity_id: conn.identity_id, folder_id: conn.folder_id, vault_id: vaultId });
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
      ...[...keyMap.values()].map((k) => ({ type: "key" as const, label: k.name ?? "Unnamed key" })),
      ...[...identityMap.values()].map((i) => ({ type: "identity" as const, label: i.name || i.username })),
    ];

    requestCascade({
      operation: "copy",
      targetVaultName,
      description: `Copying "${folder.name}" will also copy the following items to ${targetVaultName}:`,
      items: cascadeItems,
      execute: async () => {
        try {
          // Create root folder + sub-folders (BFS order ensures parent exists before child)
          const folderIdMap = new Map<string, string>();
          const destHasFolderName = folders.some((f) => (f.vault_id ?? "personal") === vaultId && f.object_type === folder.object_type && f.name === folder.name);
          const newFolder = await saveFolder({ name: destHasFolderName ? `${folder.name} (copy)` : folder.name, object_type: folder.object_type, parent_folder_id: folder.parent_folder_id, vault_id: vaultId });
          folderIdMap.set(folder.id, newFolder.id);
          for (const sf of subFolders) {
            const newParentId = sf.parent_folder_id ? (folderIdMap.get(sf.parent_folder_id) ?? newFolder.id) : newFolder.id;
            const newSf = await saveFolder({ name: sf.name, object_type: sf.object_type, parent_folder_id: newParentId, vault_id: vaultId });
            folderIdMap.set(sf.id, newSf.id);
          }

          // Copy keys
          const keyIdMap = new Map<string, string>();
          for (const key of keyMap.values()) {
            const newKey = await useKeyStore.getState().saveKey({ name: key.name, key_type: key.key_type, tags: key.tags, vault_id: vaultId });
            const [priv, pub] = await Promise.all([
              getSecret(`key:${key.id}:private`).catch(() => null),
              getSecret(`key:${key.id}:public`).catch(() => null),
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
            const pwd = await getSecret(`identity:${identity.id}:password`).catch(() => null);
            if (pwd) {
              await storeSecret(`identity:${newIdentity.id}:password`, pwd);
              await saveTeamVaultSecretForVault(vaultId, `identity:${newIdentity.id}:password`, pwd).catch(() => {});
            }
            identityIdMap.set(identity.id, newIdentity.id);
          }

          // Copy connections
          for (const conn of allConns) {
            const newIdentityId = conn.identity_id ? (identityIdMap.get(conn.identity_id) ?? conn.identity_id) : undefined;
            const newFolderId = conn.folder_id ? (folderIdMap.get(conn.folder_id) ?? newFolder.id) : newFolder.id;
            const newConn = await saveConnection({ name: conn.name, host: conn.host, port: conn.port, username: conn.username, auth_type: conn.auth_type, tags: [...conn.tags], identity_id: newIdentityId, folder_id: newFolderId, vault_id: vaultId });
            if (newConn) {
              const pwd = await getSecret(`password:${conn.id}`).catch(() => null);
              const k = await getSecret(`key:${conn.id}`).catch(() => null);
              if (pwd) {
                await storeSecret(`password:${newConn.id}`, pwd);
                await saveTeamVaultSecretForVault(vaultId, `password:${newConn.id}`, pwd).catch(() => {});
              }
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
      className="bg-[--t-bg-base]"
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
              onExport={() => useUIStore.getState().openImportExport("export", { connectionIds: connections.filter((c) => c.folder_id === editingFolder.id).map((c) => c.id) })}
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
              key={`serial-${editing?.id ?? "new"}-${formVersion}`}
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
              key={`${editing?.id ?? "new"}-${formVersion}`}
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
              setEditingId(null);
              setShowForm(true);
              setShowSerialForm(false);
              setEditingFolderId(null);
            }}
            canCreate={canCreate}
            canCreateFolder={canCreateFolder}
            onCreateFolder={() => void saveFolder({ name: "New Folder", object_type: "connection", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }).then((f) => { setShowForm(false); setShowSerialForm(false); setEditingId(null); setEditingFolderId(f.id); })}
            onCreateSerial={canCreate ? () => {
              setEditingId(null);
              setShowSerialForm(true);
              setShowForm(false);
              setEditingFolderId(null);
            } : undefined}
            onOpenLocalTerminal={() => connectLocal().catch((e) => setError(String(e)))}
            onOpenSerial={() => connectSerialEphemeral().catch((e) => setError(String(e)))}
            onOpenImportExport={(mode) => useUIStore.getState().openImportExport(mode)}
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

              {/* ── Team Sessions (live multiplayer) ── */}
              <TeamSessions />

              {/* ── Folder breadcrumb (when inside a folder) ── */}
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
                    {canCreateFolder && <button
                      className="flex items-center gap-1 text-xs transition-colors px-2 py-1 rounded-lg text-[var(--t-text-dim)]"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "var(--t-text-primary)";
                        e.currentTarget.style.background = "var(--t-bg-elevated)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "var(--t-text-dim)";
                        e.currentTarget.style.background = "transparent";
                      }}
                      onClick={() =>
                        saveFolder({ name: "New Folder", object_type: "connection", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }).then((f) => {
                          setShowForm(false); setEditingId(null); setEditingFolderId(f.id);
                        })
                      }
                    >
                      <Icon icon="lucide:plus" width={12} />
                      New
                    </button>}
                  </div>
                  <div
                    data-drag-surface="true"
                    className={layoutMode === "grid" ? "grid gap-3" : "flex flex-col gap-1.5"}
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
                          onClick={() => navigateInto(folder)}
                          onRename={(f, newName) => void updateFolder(f.id, { name: newName, object_type: f.object_type, parent_folder_id: f.parent_folder_id, vault_id: f.vault_id })}
                          onDelete={(f) => setConfirmDeleteFolderId(f.id)}
                          onSelect={(id) => { if (!selectedIdSet.has(id)) selectSingle(id); }}
                          onEdit={() => { setShowForm(false); setEditingId(null); setEditingFolderId(folder.id); }}
                          onExport={() => useUIStore.getState().openImportExport("export", { connectionIds: connections.filter((c) => c.folder_id === folder.id).map((c) => c.id) })}
                          onDragStart={(e) => handleFolderDragStart(e, folder.id)}
                          onDragEnd={handleDragEnd}
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

              {/* ── Pinned section ── */}
              {pinnedHosts.length > 0 && (
                <div className="mb-6">
                  <p className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">Pinned</p>
                  <div
                    className={layoutMode === "grid" ? "grid gap-3" : "flex flex-col gap-1.5"}
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
                          onDragStart={(e) => handleDragStart(e, conn.id)}
                          onDragEnd={handleDragEnd}
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
                    <p className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">
                      Hosts
                    </p>
                    {activeFolderId && (
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
                        onClick={() => { if (canCreate) { setEditingId(null); setShowForm(true); setShowSerialForm(false); setEditingFolderId(null); } }}
                        disabled={!canCreate}
                        style={{ opacity: !canCreate ? 0.35 : undefined }}
                      >
                        <Icon icon="lucide:plus" width={12} />
                        New
                      </button>
                    )}
                  </div>
                  <div
                    data-drag-surface="true"
                    className={layoutMode === "grid" ? "grid gap-3" : "flex flex-col gap-1.5"}
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
                          onDragStart={(e) => handleDragStart(e, conn.id)}
                          onDragEnd={handleDragEnd}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty inside folder */}
              {activeFolderId && filtered.length === 0 && !showForm && !showSerialForm && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Icon icon="lucide:folder-open" width={32} className="text-[var(--t-text-dim)]" />
                  <p className="text-sm text-[var(--t-text-dim)]">This folder is empty</p>
                  <button
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-[var(--t-bg-elevated)] text-[var(--t-accent)] border border-[var(--t-border-hover)]"
                    onClick={() => { setEditingId(null); setShowForm(true); setShowSerialForm(false); setEditingFolderId(null); }}
                  >
                    <Icon icon="lucide:plus" width={12} />
                    Add Host
                  </button>
                </div>
              )}

              {/* No search results */}
              {filtered.length === 0 && !showForm && !showSerialForm && connections.length > 0 && searchQuery && (
                <p className="text-sm mt-4 text-[var(--t-text-dim)]">
                  No hosts match "{search}"
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
            ...(canCreate ? [{ label: "New Host", icon: "lucide:server", onClick: () => { setEditingId(null); setShowForm(true); setShowSerialForm(false); setEditingFolderId(null); } } as const] : []),
            ...(canCreate ? [{ label: "New Serial Host", icon: "lucide:ethernet-port", onClick: () => { setEditingId(null); setShowSerialForm(true); setShowForm(false); setEditingFolderId(null); } } as const] : []),
            ...(canCreateFolder ? [{ label: "New Folder", icon: "lucide:folder-plus", onClick: () => void saveFolder({ name: "New Folder", object_type: "connection", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }).then((f) => { setShowForm(false); setEditingId(null); setEditingFolderId(f.id); }) } as const] : []),
            ...bgContributions,
          ]}
        />
      )}
    </SidePanelLayout>

      {confirmDeleteIds && (
        <ConfirmModal
          title={`Delete ${confirmDeleteIds.length} item${confirmDeleteIds.length === 1 ? "" : "s"}`}
          message={`Are you sure you want to delete ${confirmDeleteIds.length} item${confirmDeleteIds.length === 1 ? "" : "s"}? This cannot be undone.`}
          confirmLabel="Delete"
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

function DraftHostCard({ layout, serial = false }: { layout: "grid" | "list"; serial?: boolean }) {
  const icon = serial ? "lucide:ethernet-port" : "lucide:server";
  const label = serial ? "New Serial Host" : "New Host";
  if (layout === "list") {
    return (
      <div
        className="flex items-center gap-3 px-4 py-2 rounded-xl"
        style={{ border: "2px dashed var(--t-accent)", opacity: 0.5 }}
      >
        <div
          className="rounded-lg flex items-center justify-center shrink-0 w-[1.867rem] h-[1.867rem] bg-[var(--t-bg-card-avatar)]"
        >
          <Icon icon={icon} width={14} className="text-[var(--t-text-dim)]" />
        </div>
        <p className="text-sm font-medium-bold text-[var(--t-text-dim)]">{label}</p>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-4 px-4 py-4 rounded-2xl"
      style={{ border: "2px dashed var(--t-accent)", opacity: 0.5 }}
    >
      <div
        className="rounded-lg flex items-center justify-center shrink-0 w-[3.2rem] h-[3.2rem] bg-[var(--t-bg-card-avatar)]"
      >
        <Icon icon={icon} width={22} className="text-[var(--t-text-dim)]" />
      </div>
      <div>
        <p className="text-base font-medium-bold text-[var(--t-text-dim)]">{label}</p>
        <p className="text-xs mt-0.5 text-[var(--t-text-dim)]">Unsaved</p>
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[320px] gap-5">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center bg-[var(--t-bg-toolbar)] border border-[var(--t-border)]"
      >
        <Icon icon="lucide:monitor" width={28} className="text-[var(--t-text-dim)]" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium mb-1 text-[var(--t-text-primary)]">No hosts yet</p>
        <p className="text-xs text-[var(--t-text-dim)]">Add your first SSH host to get started</p>
      </div>
      {onAdd && <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-[var(--t-bg-elevated)] text-[var(--t-accent)] border border-[var(--t-border-hover)]"
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-border-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
      >
        <Icon icon="lucide:plus" width={14} />
        Add Host
      </button>}
    </div>
  );
}
