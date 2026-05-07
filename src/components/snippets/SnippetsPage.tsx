import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { usePermissions } from "@/hooks/usePermission";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { useDragToFolder } from "@/hooks/useDragToFolder";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { useAllSnippets } from "@/hooks/useAllSnippets";
import { useAllConnections } from "@/hooks/useAllConnections";
import { DragSelectSurface } from "@/components/shared/DragSelectSurface";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { broadcastSnippetInject } from "@/services/snippets";
import {
  parseVariables,
  needsUserInput,
  buildDynamicValues,
  buildDefaultValues,
  resolveTemplate,
  type DynamicContext,
} from "@/services/snippetParser";
import { SnippetVariableModal } from "@/components/terminal/SnippetVariableModal";
import { SidePanelLayout } from "@/components/shared/SidePanelLayout";
import { useEditPanel } from "@/hooks/useEditPanel";
import { useSyncedFormKey } from "@/hooks/useSyncedFormKey";
import { SnippetsToolbar } from "./SnippetsToolbar";
import { SnippetCard } from "./SnippetCard";
import { SnippetForm } from "./SnippetForm";
import { FolderCard } from "@/components/folders/FolderCard";
import { FolderEditPanel } from "@/components/folders/FolderEditPanel";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import type { Snippet, Folder, SnippetFormData, Connection, VaultOption } from "@/types";
import type { SortMode } from "@/components/shared/ToolbarViewControls";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDynamicContext(
  session: { type: string; connectionId: string; connectionName: string } | undefined,
  connections: Connection[],
  clipboard = "",
): DynamicContext {
  if (!session || session.type === "local") {
    return { connectionHost: "localhost", connectionUsername: "local", connectionName: "Local Shell", clipboard };
  }
  const conn = connections.find((c) => c.id === session.connectionId);
  return {
    connectionHost: conn?.host ?? "",
    connectionUsername: conn?.username ?? "",
    connectionName: session.connectionName,
    clipboard,
  };
}

function isContextuallyRelevant(snippet: Snippet, conn: Connection | undefined): boolean {
  if (snippet.only_for_connection_tags?.length && conn) {
    if (!conn.tags.some((t) => snippet.only_for_connection_tags.includes(t))) return false;
  }
  if (snippet.only_for_distros?.length && conn) {
    if (!snippet.only_for_distros.includes(conn.distro ?? "")) return false;
  }
  return true;
}

function sortSnippets(list: Snippet[], mode: SortMode): Snippet[] {
  return [...list].sort((a, b) => {
    if (mode === "name-asc")  return a.name.localeCompare(b.name);
    if (mode === "name-desc") return b.name.localeCompare(a.name);
    if (mode === "newest")    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (mode === "oldest")    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return 0;
  });
}

function snippetToForm(s: Snippet): SnippetFormData {
  return {
    name: s.name,
    content: s.content,
    description: s.description,
    tags: s.tags,
    folder_id: s.folder_id,
    favorite: s.favorite,
    only_for_connection_tags: s.only_for_connection_tags,
    only_for_distros: s.only_for_distros,
    vault_id: s.vault_id,
  };
}


// ─── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">
        {label}
        {count !== undefined && (
          <span className="ml-2 font-normal normal-case tracking-normal">{count}</span>
        )}
      </p>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16">
      <div
        className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-[var(--t-text-dim)]"
        style={{
          background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
          border: "1px solid var(--t-border)",
        }}
      >
        <Icon icon="lucide:braces" width={36} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-base font-semibold text-[var(--t-text-primary)]">No snippets yet</span>
        <span className="text-sm text-[var(--t-text-dim)] max-w-[18rem]">
          Save reusable terminal commands with dynamic variables.
        </span>
      </div>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors bg-[var(--t-bg-elevated)] text-[var(--t-accent)] border border-[var(--t-border-hover)]"
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
      >
        <Icon icon="lucide:plus" width={15} />
        Create your first snippet
      </button>
    </div>
  );
}


// ─── Main page ────────────────────────────────────────────────────────────────

export function SnippetsPage() {
  const { loading, loadSnippets, createSnippet, updateSnippet, deleteSnippet, trackUsed } = useSnippetStore();
  const snippets = useAllSnippets();
  const { folders, loadFolders, saveFolder, updateFolder, deleteFolder, moveFolder } = useSnippetFolderStore();
  const { sessions, activeSessionId } = useSessionStore();
  const connections = useAllConnections();
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const layoutMode = useUIStore((s) => s.snippetsLayoutMode);
  const setLayoutMode = useUIStore((s) => s.setSnippetsLayoutMode);

  // Vault & permissions
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const accessibleVaultIds = useAccessibleVaultIds();
  const can = usePermissions();

  const vaultOptions = useMemo<VaultOption[]>(() => {
    const linkedTeamIds = new Set(vaults.map((v) => v.teamId).filter(Boolean));
    return [
      { id: "personal", name: "Personal" },
      ...vaults.filter((v) => v.id !== "personal").map((v) => ({ id: v.teamId ?? v.id, name: v.name })),
      ...teams.filter((t) => !linkedTeamIds.has(t.id)).map((t) => ({ id: t.id, name: t.name })),
    ];
  }, [vaults, teams]);

  const canCreate = selectedVaultIds.some((vid) => can("EDIT_CONNECTIONS", vid));

  // Sync prefs (reactive)
  const excludedIds = useSyncPrefsStore((s) => s.excludedIds);
  const syncTypes = useSyncPrefsStore((s) => s.syncTypes);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeConn = connections.find((c) => c.id === activeSession?.connectionId);

  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name-asc");

  // Editing state
  const ep = useEditPanel<Snippet>();
  const folderEp = useEditPanel<Folder>();
  const editingFolder = folderEp.editing !== null && folderEp.editing !== "new" ? folderEp.editing : null;

  const snippetIsDirtyRef = useRef(false);
  const openSnippet = useCallback((item: Snippet | "new") => {
    snippetIsDirtyRef.current = false;
    ep.openEdit(item);
  }, [ep.openEdit]);
  const liveEditingSnippet = ep.editing && ep.editing !== "new"
    ? (snippets.find((s) => s.id === (ep.editing as Snippet).id) ?? (ep.editing as Snippet))
    : null;
  const snippetFormVersion = useSyncedFormKey(
    liveEditingSnippet?.updated_at,
    ep.panelOpen && ep.editing !== "new",
    () => snippetIsDirtyRef.current,
  );
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<Folder | null>(null);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);

  // Background context menu
  const { pos: bgMenuPos, open: openBgMenu, close: closeBgMenu } = useContextMenu();

  // Inject modal
  const [pendingInject, setPendingInject] = useState<{
    snippet: Snippet;
    partialTemplate: string;
    userVars: ReturnType<typeof parseVariables>;
    initialValues: Record<string, string>;
    execute: boolean;
    sessionId: string;
  } | null>(null);


  // Folder navigation
  const {
    folderPath,
    activeFolderId,
    ejectTargetFolderId,
    visibleFolders,
    navigateInto,
    navigateTo,
    navigateToRoot,
    onFolderDeleted,
  } = useFolderNavigation(folders);

  useEffect(() => {
    void loadSnippets();
    void loadFolders();
  }, []);

  // ── Derived state ────────────────────────────────────────────────────────

  const allFolderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const hasSearch = search.length > 0;

  // Base filter: search + vault access
  const filtered = useMemo(() => sortSnippets(
    snippets.filter((s) => {
      const svid = s.vault_id ?? "personal";
      if (accessibleVaultIds.length > 0 && !accessibleVaultIds.includes(svid)) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      );
    }),
    sortMode,
  ), [snippets, search, sortMode, accessibleVaultIds]);

  // Snippets visible in the current view (respects folder navigation)
  const viewSnippets = useMemo(() => {
    if (hasSearch) return filtered;
    if (activeFolderId) return filtered.filter((s) => s.folder_id === activeFolderId);
    return filtered.filter((s) => !s.folder_id || !allFolderIds.has(s.folder_id));
  }, [filtered, hasSearch, activeFolderId, allFolderIds]);

  const filteredIds = useMemo(
    () => [...visibleFolders.map((f) => f.id), ...viewSnippets.map((s) => s.id)],
    [visibleFolders, viewSnippets],
  );

  const favorites = useMemo(
    () => (!hasSearch && !activeFolderId) ? filtered.filter((s) => s.favorite) : [],
    [filtered, hasSearch, activeFolderId],
  );

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of snippets) {
      if (s.folder_id) counts[s.folder_id] = (counts[s.folder_id] ?? 0) + 1;
    }
    return counts;
  }, [snippets]);

  // ── Drag selection ───────────────────────────────────────────────────────

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

  const { focusedId, setFocusedId } = useListKeyNav({
    orderedIds: filteredIds,
    selectedIdSet,
    selectSingle,
    setSelection,
    itemAreaRef,
    layoutMode: "list",
    onEnter: (id) => {
      const folder = visibleFolders.find((f) => f.id === id);
      if (folder) { navigateInto(folder); return; }
      const s = viewSnippets.find((s) => s.id === id);
      if (s) openSnippet(s);
    },
    onEdit: (id) => {
      const s = viewSnippets.find((s) => s.id === id);
      if (s) openSnippet(s);
    },
    onDuplicate: (id) => {
      const s = snippets.find((s) => s.id === id);
      if (s) void handleDuplicate(s);
    },
    onEscape: () => { if (ep.panelOpen) ep.closeEdit(); else setSelection([]); },
    onSearch: () => setOmniOpen(true),
    onBackspace: () => { if (activeFolderId) navigateToRoot(); },
    extraKeys: {
      f: (id) => { const s = snippets.find((s) => s.id === id); if (s) void handleToggleFavorite(s); },
      F: (id) => { const s = snippets.find((s) => s.id === id); if (s) void handleToggleFavorite(s); },
    },
  });

  useEffect(() => { setFocusedId(null); }, [activeFolderId]);

  useEffect(() => {
    const handler = () => {
      if (useUIStore.getState().activeNav !== "snippets") return;
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
      for (const id of ids) {
        const s = snippets.find((x) => x.id === id);
        if (s) await updateSnippet(id, { ...snippetToForm(s), folder_id: folderId });
      }
    },
    onEject: async (ids, targetFolderId) => {
      for (const id of ids) {
        const s = snippets.find((x) => x.id === id);
        if (s) await updateSnippet(id, { ...snippetToForm(s), folder_id: targetFolderId ?? undefined });
      }
    },
    onMoveFolders: async (folderDragIds, targetParentId) => {
      for (const id of folderDragIds) await moveFolder(id, targetParentId);
    },
    onEjectFolders: async (folderDragIds, targetParentId) => {
      for (const id of folderDragIds) await moveFolder(id, targetParentId);
    },
  });

  // ── Bulk context menu ────────────────────────────────────────────────────

  const bulkContextMenuItems = useMemo<ContextMenuItem[] | undefined>(() => {
    if (selectedIdSet.size <= 1) return undefined;
    const ids = [...selectedIdSet];
    const selectedSnippets = viewSnippets.filter((s) => selectedIdSet.has(s.id));
    const { isObjectSynced } = useSyncPrefsStore.getState();
    const allSynced = selectedSnippets.every((s) => isObjectSynced(s.id, "snippet"));
    const allCanEdit = selectedSnippets.every((s) => can("EDIT_CONNECTIONS", s.vault_id ?? "personal"));
    return [
      ...(allCanEdit ? [{
        label: `Duplicate ${ids.length} snippets`,
        icon: "lucide:copy",
        onClick: () => { void Promise.all(selectedSnippets.map((s) => handleDuplicate(s))); },
      }] : []),
      {
        label: allSynced ? `Disable cloud sync (${ids.length})` : `Enable cloud sync (${ids.length})`,
        icon: allSynced ? "lucide:cloud-off" : "lucide:cloud",
        onClick: () => {
          const store = useSyncPrefsStore.getState();
          for (const s of selectedSnippets) {
            const isSynced = store.isObjectSynced(s.id, "snippet");
            if (allSynced && isSynced) store.toggleExcluded(s.id);
            else if (!allSynced && !isSynced) store.toggleExcluded(s.id);
          }
        },
        divider: true,
      },
      {
        label: `Delete ${ids.length} snippets`,
        icon: "lucide:trash-2",
        onClick: () => setConfirmDeleteIds(ids),
        danger: true,
        divider: true,
      },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdSet, viewSnippets, excludedIds, syncTypes, can]);

  // ── Injection ────────────────────────────────────────────────────────────

  async function handleTrigger(snippet: Snippet, execute: boolean, sessionId: string) {
    const targetSession = sessions.find((s) => s.id === sessionId);
    if (!targetSession || targetSession.type === "multiplayer") return;
    trackUsed(snippet.id);

    let clipboard = "";
    try { clipboard = await navigator.clipboard.readText(); } catch { /* permission denied */ }
    const ctx = buildDynamicContext(targetSession, connections, clipboard);

    const vars = parseVariables(snippet.content);
    const dynValues = buildDynamicValues(vars, ctx);
    const partialTemplate = resolveTemplate(snippet.content, dynValues);

    const userVars = vars.filter((v) => !v.dynamic);
    const initialValues = buildDefaultValues(userVars);
    const missing = userVars.filter((v) => needsUserInput(v));

    if (missing.length === 0) {
      const resolved = resolveTemplate(partialTemplate, initialValues);
      const payload = execute ? `${resolved}\n` : resolved;
      await broadcastSnippetInject(targetSession.id, targetSession.type, payload, execute).catch(console.error);
    } else {
      setPendingInject({ snippet, partialTemplate, userVars, initialValues, execute, sessionId });
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async function handleSaveSnippet(data: SnippetFormData) {
    if (ep.editing === "new") {
      const created = await createSnippet(data);
      ep.transitionToExisting(created);
    } else if (ep.editing) {
      await updateSnippet(ep.editing.id, data);
    }
  }

  async function handleDuplicate(snippet: Snippet) {
    await createSnippet({
      name: `${snippet.name} (copy)`,
      content: snippet.content,
      description: snippet.description,
      tags: [...snippet.tags],
      folder_id: snippet.folder_id,
      favorite: false,
      only_for_connection_tags: [...snippet.only_for_connection_tags],
      only_for_distros: [...snippet.only_for_distros],
      vault_id: snippet.vault_id,
    });
  }

  async function handleToggleFavorite(snippet: Snippet) {
    await updateSnippet(snippet.id, { ...snippetToForm(snippet), favorite: !snippet.favorite });
  }

  async function handleMoveToVault(snippet: Snippet, vaultId: string) {
    await updateSnippet(snippet.id, { ...snippetToForm(snippet), vault_id: vaultId });
  }

  async function handleCopyToVault(snippet: Snippet, vaultId: string) {
    const destHasName = snippets.some((s) => (s.vault_id ?? "personal") === vaultId && s.name === snippet.name);
    await createSnippet({
      ...snippetToForm(snippet),
      name: destHasName ? `${snippet.name} (copy)` : snippet.name,
      vault_id: vaultId,
      favorite: false,
    });
  }

  // ── Folder vault move / copy ──────────────────────────────────────────────

  function getAllSubFolders(folderId: string): Folder[] {
    const queue = [folderId];
    const result: Folder[] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      const children = folders.filter((f) => f.parent_folder_id === cur);
      result.push(...children);
      queue.push(...children.map((f) => f.id));
    }
    return result;
  }

  function getSnippetsInFolderTree(folderId: string): Snippet[] {
    const ids = new Set([folderId, ...getAllSubFolders(folderId).map((f) => f.id)]);
    return snippets.filter((s) => s.folder_id != null && ids.has(s.folder_id));
  }

  async function handleMoveFolderToVault(folder: Folder, vaultId: string) {
    try {
      const subFolders = getAllSubFolders(folder.id);
      const treeSnippets = getSnippetsInFolderTree(folder.id);
      await updateFolder(folder.id, { name: folder.name, object_type: folder.object_type, parent_folder_id: folder.parent_folder_id, vault_id: vaultId });
      for (const sf of subFolders) {
        await updateFolder(sf.id, { name: sf.name, object_type: sf.object_type, parent_folder_id: sf.parent_folder_id, vault_id: vaultId });
      }
      for (const s of treeSnippets) {
        await updateSnippet(s.id, { ...snippetToForm(s), vault_id: vaultId });
      }
    } catch (err) { console.error(err); }
  }

  async function handleCopyFolderToVault(folder: Folder, vaultId: string) {
    try {
      const subFolders = getAllSubFolders(folder.id);
      const treeSnippets = getSnippetsInFolderTree(folder.id);
      const folderIdMap = new Map<string, string>();
      const destHasName = folders.some((f) => (f.vault_id ?? "personal") === vaultId && f.object_type === folder.object_type && f.name === folder.name);
      const newRoot = await saveFolder({ name: destHasName ? `${folder.name} (copy)` : folder.name, object_type: folder.object_type, parent_folder_id: folder.parent_folder_id, vault_id: vaultId });
      folderIdMap.set(folder.id, newRoot.id);
      for (const sf of subFolders) {
        const newParentId = sf.parent_folder_id ? (folderIdMap.get(sf.parent_folder_id) ?? newRoot.id) : newRoot.id;
        const newSf = await saveFolder({ name: sf.name, object_type: sf.object_type, parent_folder_id: newParentId, vault_id: vaultId });
        folderIdMap.set(sf.id, newSf.id);
      }
      for (const s of treeSnippets) {
        const newFolderId = s.folder_id ? (folderIdMap.get(s.folder_id) ?? newRoot.id) : newRoot.id;
        const destHasSnippetName = snippets.some((x) => (x.vault_id ?? "personal") === vaultId && x.name === s.name);
        await createSnippet({ ...snippetToForm(s), name: destHasSnippetName ? `${s.name} (copy)` : s.name, folder_id: newFolderId, vault_id: vaultId, favorite: false });
      }
    } catch (err) { console.error(err); }
  }

  async function handleCreateFolder() {
    ep.closeEdit();
    const folder = await saveFolder({
      name: "New Folder",
      object_type: "snippet",
      parent_folder_id: activeFolderId ?? undefined,
    });
    folderEp.transitionToExisting(folder);
  }

  async function handleDeleteFolder(folder: Folder) {
    await deleteFolder(folder.id);
    onFolderDeleted(folder.id);
    folderEp.closeEdit();
    setConfirmDeleteFolder(null);
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderCard(s: Snippet) {
    const svid = s.vault_id ?? "personal";
    const canEdit = can("EDIT_CONNECTIONS", svid);
    const otherVaults = vaultOptions.filter((v) => v.id !== svid);
    const syncEnabled = useSyncPrefsStore.getState().isObjectSynced(s.id, "snippet");
    return (
      <SnippetCard
        key={s.id}
        snippet={s}
        folders={folders}
        isEditing={ep.isEditing(s)}
        isSelected={selectedIdSet.has(s.id)}
        isFocused={focusedId === s.id}
        dimmed={!isContextuallyRelevant(s, activeConn)}
        layout={layoutMode}
        onEdit={() => openSnippet(s)}
        onSelect={(id, e) => {
          handleItemSelect(id, e);
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey) openSnippet(s);
        }}
        onInsert={(sessionId) => void handleTrigger(s, false, sessionId)}
        onExecute={(sessionId) => void handleTrigger(s, true, sessionId)}
        onDuplicate={() => void handleDuplicate(s)}
        onDelete={() => void deleteSnippet(s.id)}
        onToggleFavorite={() => void handleToggleFavorite(s)}
        bulkContextMenuItems={bulkContextMenuItems}
        vaults={otherVaults}
        canEdit={canEdit}
        onMoveToVault={canEdit ? (vaultId) => void handleMoveToVault(s, vaultId) : undefined}
        onCopyToVault={canEdit ? (vaultId) => void handleCopyToVault(s, vaultId) : undefined}
        syncEnabled={syncEnabled}
        onToggleSync={() => useSyncPrefsStore.getState().toggleExcluded(s.id)}
        onDragStart={(e) => handleDragStart(e, s.id)}
        onDragEnd={handleDragEnd}
      />
    );
  }

  return (
    <>
    <SidePanelLayout
      panelOpen={ep.panelOpen || folderEp.panelOpen}
      panelWidth={360}
      panel={
        editingFolder !== null ? (
          <FolderEditPanel
            key={editingFolder.id}
            folder={editingFolder}
            onUpdate={(id, data) => void updateFolder(id, data)}
            onDelete={(f) => setConfirmDeleteFolder(f)}
            onClose={folderEp.closeEdit}
            canEdit
            syncObjectType="snippet"
            vaults={vaultOptions.filter((v) => v.id !== (editingFolder.vault_id ?? "personal"))}
            onMoveToVault={(vaultId) => void handleMoveFolderToVault(editingFolder, vaultId)}
            onCopyToVault={(vaultId) => void handleCopyFolderToVault(editingFolder, vaultId)}
          />
        ) : ep.editing !== null ? (
          <SnippetForm
            key={ep.editing === "new" ? "__new__" : `${liveEditingSnippet?.id ?? ""}-${snippetFormVersion}`}
            initial={ep.editing === "new" ? undefined : liveEditingSnippet ?? undefined}
            onSubmit={handleSaveSnippet}
            onClose={ep.closeEdit}
            onDuplicate={ep.editing !== "new" ? () => { void handleDuplicate(ep.editing as Snippet); ep.closeEdit(); } : undefined}
            onDelete={ep.editing !== "new" ? () => { void deleteSnippet((ep.editing as Snippet).id); ep.closeEdit(); } : undefined}
            isDirtyRef={snippetIsDirtyRef}
          />
        ) : null
      }
    >
      {/* ── Toolbar ── */}
      <SnippetsToolbar
        search={search}
        onSearchChange={setSearch}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        onNewSnippet={() => openSnippet("new")}
        onNewFolder={() => void handleCreateFolder()}
      />

      {/* ── Main content ── */}
      <DragSelectSurface
        selectionAreaRef={selectionAreaRef}
        onMouseDown={handleSelectionAreaMouseDown}
        dragBox={dragBox}
        className="flex-1 overflow-y-auto px-9 pt-5 pb-9"
        onClick={() => {
          if (folderEp.panelOpen) { folderEp.closeEdit(); return; }
          if (!ep.panelOpen) return;
          ep.closeEdit();
        }}
        onContextMenu={(e) => {
          if ((e.target as Element).closest("[data-card],[data-folder-card]")) return;
          setSelection([]);
          openBgMenu(e);
        }}
      >
        <div ref={itemAreaRef} data-drag-surface="true">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <span className="text-sm text-[var(--t-text-dim)]">Loading…</span>
            </div>
          ) : snippets.length === 0 ? (
            <EmptyState onAdd={() => openSnippet("new")} />
          ) : (
            <div className="space-y-6">

              {/* ── Breadcrumb (when inside a folder) ── */}
              {folderPath.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    className="flex items-center gap-1.5 text-xs transition-colors text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)]"
                    onClick={navigateToRoot}
                  >
                    <Icon icon="lucide:chevron-left" width={13} />
                    All Snippets
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

              {/* ── Pinned (root only) ── */}
              {favorites.length > 0 && (
                <div>
                  <SectionHeader label="Pinned" count={favorites.length} />
                  <div className={layoutMode === "grid" ? "grid gap-3" : "flex flex-col gap-1.5"} style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" } : undefined}>{favorites.map(renderCard)}</div>
                </div>
              )}

              {/* ── Folders ── */}
              {visibleFolders.length > 0 && (
                <div>
                  <SectionHeader label="Folders" />
                  <div className="flex flex-col gap-1.5">
                    {visibleFolders.map((folder) => (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        itemCount={folderCounts[folder.id] ?? 0}
                        layout="list"
                        isSelected={editingFolder?.id === folder.id || selectedIdSet.has(folder.id)}
                        isFocused={focusedId === folder.id}
                        isDragOver={dragOverFolderId === folder.id}
                        onClick={() => navigateInto(folder)}
                        onRename={(f, newName) => void updateFolder(f.id, { name: newName, object_type: f.object_type, parent_folder_id: f.parent_folder_id })}
                        onDelete={(f) => setConfirmDeleteFolder(f)}
                        onSelect={(id) => { if (!selectedIdSet.has(id)) selectSingle(id); }}
                        onEdit={() => { ep.closeEdit(); folderEp.transitionToExisting(folder); }}
                        canEdit
                        onDragStart={(e) => handleFolderDragStart(e, folder.id)}
                        onDragEnd={handleDragEnd}
                        {...folderDropProps(folder.id)}
                        vaults={vaultOptions.filter((v) => v.id !== (folder.vault_id ?? "personal"))}
                        onMoveToVault={(vaultId) => void handleMoveFolderToVault(folder, vaultId)}
                        onCopyToVault={(vaultId) => void handleCopyFolderToVault(folder, vaultId)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ── Eject drop zone (inside folder, visible only while dragging) ── */}
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

              {/* ── Snippets in current view ── */}
              {viewSnippets.length > 0 ? (
                <div>
                  {(visibleFolders.length > 0 || favorites.length > 0 || activeFolderId) && !hasSearch && (
                    <SectionHeader
                      label={activeFolderId ? "Snippets" : "Unfiled"}
                      count={viewSnippets.length}
                    />
                  )}
                  <div className={layoutMode === "grid" ? "grid gap-3" : "flex flex-col gap-1.5"} style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" } : undefined}>{viewSnippets.map(renderCard)}</div>
                </div>
              ) : !hasSearch && filtered.length > 0 && activeFolderId ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Icon icon="lucide:folder-open" width={32} className="text-[var(--t-text-dim)]" />
                  <p className="text-sm text-[var(--t-text-dim)]">This folder is empty</p>
                  <button
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-[var(--t-bg-elevated)] text-[var(--t-accent)] border border-[var(--t-border-hover)]"
                    onClick={() => openSnippet("new")}
                  >
                    <Icon icon="lucide:plus" width={12} />
                    Add Snippet
                  </button>
                </div>
              ) : hasSearch && filtered.length === 0 ? (
                <p className="mt-6 text-sm text-[var(--t-text-dim)]">No snippets match "{search}"</p>
              ) : null}

            </div>
          )}
        </div>
      </DragSelectSurface>

      {/* ── Background context menu ── */}
      {bgMenuPos && (
        <ContextMenu
          pos={bgMenuPos}
          onClose={closeBgMenu}
          items={[
            ...(canCreate ? [{ label: "New Snippet", icon: "lucide:braces", onClick: () => openSnippet("new") } as const] : []),
            { label: "New Folder", icon: "lucide:folder-plus", onClick: () => void handleCreateFolder() },
          ]}
        />
      )}
    </SidePanelLayout>

    {/* ── Confirm folder delete ── */}
    {confirmDeleteFolder && (
      <ConfirmModal
        title={`Delete "${confirmDeleteFolder.name}"?`}
        message="Snippets inside will be moved to the root. This cannot be undone."
        confirmLabel="Delete folder"
        onConfirm={() => void handleDeleteFolder(confirmDeleteFolder)}
        onCancel={() => setConfirmDeleteFolder(null)}
      />
    )}

    {/* ── Confirm bulk delete ── */}
    {confirmDeleteIds && (
      <ConfirmModal
        title={`Delete ${confirmDeleteIds.length} snippets`}
        message={`Are you sure you want to delete ${confirmDeleteIds.length} snippet${confirmDeleteIds.length === 1 ? "" : "s"}? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          for (const id of confirmDeleteIds) void deleteSnippet(id);
          setSelection([]);
          setConfirmDeleteIds(null);
        }}
        onCancel={() => setConfirmDeleteIds(null)}
      />
    )}

    {/* ── Variable modal ── */}
    {pendingInject && (
      <SnippetVariableModal
        snippetName={pendingInject.snippet.name}
        partialTemplate={pendingInject.partialTemplate}
        userVars={pendingInject.userVars}
        initialValues={pendingInject.initialValues}
        onInject={async (resolvedText, execute) => {
          const targetSession = sessions.find((s) => s.id === pendingInject.sessionId);
          if (!targetSession) return;
          const payload = execute ? `${resolvedText}\n` : resolvedText;
          await broadcastSnippetInject(targetSession.id, targetSession.type, payload, execute).catch(console.error);
          setPendingInject(null);
        }}
        onClose={() => setPendingInject(null)}
      />
    )}
    </>
  );
}
