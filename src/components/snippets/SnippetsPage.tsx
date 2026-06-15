import { readClipboard } from "../../utils/clipboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useTeamStore } from "@/stores/teamStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { usePermissions } from "@/hooks/usePermission";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { usePageBulkActions } from "@/hooks/usePageBulkActions";
import { useDragToFolder } from "@/hooks/useDragToFolder";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { useEffectivePinnedPredicate } from "@/hooks/useEffectivePinned";
import { useAllSnippets } from "@/hooks/useAllSnippets";
import { useAllConnections } from "@/hooks/useAllConnections";
import { DragSelectSurface } from "@/components/shared/DragSelectSurface";
import { BaseCard } from "@/components/shared/BaseCard";
import { waitForConnectedSessionIds } from "@/components/shared/sessionPickerTargets";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { broadcastSnippetInject } from "@/services/snippets";
import {
  parseVariables,
  needsUserInput,
  buildDynamicValues,
  buildDefaultValues,
  resolveTemplate,
} from "@/services/snippetParser";
import { buildDynamicContext } from "@/services/snippetRunCore";
import { snippetToForm } from "@/utils/snippetForm";
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
import { buildTeamVaultTransferPlan, type TransferOperation } from "@/services/teamVaultPermissions";
import { useSnippetRecentStore, type RecentSnippetExecution, type RecentTarget } from "@/stores/snippetRecentStore";
import { selectRecentSnippetEntries } from "@/utils/snippetRecent";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── Recent section ────────────────────────────────────────────────────────────

const RECENT_PREVIEW_COUNT = 5;

interface RecentCardProps {
  entry: RecentSnippetExecution;
  snippet: Snippet | undefined;
  layout: "grid" | "list";
  onReplay: () => void;
  onRemove: () => void;
}

function RecentCard({ entry, snippet, layout, onReplay, onRemove }: RecentCardProps) {
  const isList = layout === "list";
  const label = snippet?.name ?? "Deleted snippet";
  const isDeleted = !snippet;
  const primaryTarget = entry.targets[0];
  const host = primaryTarget
    ? entry.targets.length > 1
      ? `${primaryTarget.connectionName} +${entry.targets.length - 1} more`
      : primaryTarget.connectionName
    : "Unknown";
  const hostIcon = primaryTarget?.sessionType === "local" ? "lucide:terminal" : "lucide:server";

  const modeBadge = (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0"
      style={{
        background: entry.execute
          ? "color-mix(in srgb, var(--t-accent) 12%, transparent)"
          : "color-mix(in srgb, var(--t-text-dim) 10%, transparent)",
        color: entry.execute ? "var(--t-accent)" : "var(--t-text-dim)",
      }}
    >
      {entry.execute ? "run" : "insert"}
    </span>
  );

  const removeButton = (
    <button
      title="Remove"
      onClick={(e) => { e.stopPropagation(); onRemove(); }}
      className="p-1.5 rounded-lg transition-colors text-(--t-text-dim)"
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-dim)")}
    >
      <Icon icon="lucide:x" width={13} />
    </button>
  );

  const replayButton = (
    <button
      title="Replay"
      disabled={isDeleted}
      onClick={(e) => { e.stopPropagation(); onReplay(); }}
      className="p-1.5 rounded-lg transition-colors text-(--t-text-secondary) disabled:opacity-30 disabled:cursor-not-allowed"
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-bright)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-secondary)")}
    >
      <Icon icon="lucide:rotate-ccw" width={14} />
    </button>
  );

  if (!isList) {
    return (
      <BaseCard
        isList={false}
        style={{ opacity: isDeleted ? 0.5 : 1 }}
        onClick={!isDeleted ? onReplay : undefined}
      >
        <div className="flex-1 min-w-0 self-start flex flex-col gap-2.5">
          {/* Header */}
          <div className="flex items-start gap-2 min-w-0">
            <AvatarTile icon="lucide:history" iconSize={14} className="w-7 h-7 rounded-lg" />
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm font-bold truncate text-(--t-text-bright) flex-1 min-w-0">{label}</p>
                {modeBadge}
              </div>
              <p className="text-xs text-(--t-text-muted) truncate">{formatRelativeTime(entry.timestamp)}</p>
            </div>
          </div>

          {/* Target host */}
          <div
            className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
            style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)" }}
          >
            <Icon icon={hostIcon} width={12} className="shrink-0 text-(--t-text-dim)" />
            <span className="text-xs text-(--t-text-secondary) truncate">{host}</span>
          </div>

          <div className="flex justify-between items-center -mt-0.5">
            {removeButton}
            {replayButton}
          </div>
        </div>
      </BaseCard>
    );
  }

  return (
    <BaseCard isList style={{ opacity: isDeleted ? 0.5 : 1 }} onClick={!isDeleted ? onReplay : undefined}>
      {/* Icon */}
      <AvatarTile icon="lucide:history" iconSize={14} className="w-8 h-8 rounded-lg" />

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-(--t-text-bright) truncate flex-1 min-w-0">{label}</span>
          {modeBadge}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Icon icon={hostIcon} width={10} className="shrink-0 text-(--t-text-dim)" />
          <span className="text-xs text-(--t-text-muted) truncate">{host}</span>
          <span className="text-xs text-(--t-text-dim)">·</span>
          <span className="text-xs text-(--t-text-dim)">{formatRelativeTime(entry.timestamp)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        {removeButton}
        {replayButton}
      </div>
    </BaseCard>
  );
}

// ─── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
        {label}
        {count !== undefined && (
          <span className="ml-2 font-normal normal-case tracking-normal">{count}</span>
        )}
      </p>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function SkeletonList() {
  return (
    <div className="flex flex-col gap-1.5 animate-pulse">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-2xl bg-(--t-bg-card)">
          <div className="w-8 h-8 rounded-lg shrink-0 bg-(--t-bg-card-avatar)" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="h-3 rounded-md bg-(--t-bg-elevated)" style={{ width: `${45 + (i * 17) % 40}%` }} />
            <div className="h-2.5 rounded-md bg-(--t-bg-elevated)" style={{ width: `${55 + (i * 13) % 30}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16">
      <div
        className="flex items-center justify-center rounded-3xl w-[5.333rem] h-[5.333rem] text-(--t-text-dim)"
        style={{
          background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)",
          border: "1px solid var(--t-border)",
        }}
      >
        <Icon icon="lucide:braces" width={36} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-base font-semibold text-(--t-text-primary)">No snippets yet</span>
        <span className="text-sm text-(--t-text-dim) max-w-[18rem]">
          Save reusable terminal commands with dynamic variables.
        </span>
      </div>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors bg-(--t-bg-elevated) text-(--t-accent) border border-(--t-border-hover)"
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
  const { loading, loadSnippets, createSnippet, updateSnippet, deleteSnippet, trackUsed, pinSnippet } = useSnippetStore();
  const recentEntries = useSnippetRecentStore((s) => s.entries);
  const addRecentEntry = useSnippetRecentStore((s) => s.add);
  const removeRecentEntry = useSnippetRecentStore((s) => s.remove);
  const snippets = useAllSnippets();
  const { folders, loadFolders, saveFolder, updateFolder, deleteFolder, moveFolder } = useSnippetFolderStore();
  const { sessions, activeSessionId } = useSessionStore();
  const connections = useAllConnections();
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const layoutMode = useUIStore((s) => s.snippetsLayoutMode);
  const setLayoutMode = useUIStore((s) => s.setSnippetsLayoutMode);
  const snippetsPendingAction = useUIStore((s) => s.snippetsPendingAction);
  const setSnippetsPendingAction = useUIStore((s) => s.setSnippetsPendingAction);

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

  const canCreate = selectedVaultIds.some((vid) => can("EDIT_SNIPPETS", vid));

  // Sync prefs (reactive)
  const excludedIds = useSyncPrefsStore((s) => s.excludedIds);
  const syncTypes = useSyncPrefsStore((s) => s.syncTypes);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeConn = connections.find((c) => c.id === activeSession?.connectionId);

  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name-asc");
  const [showAllRecent, setShowAllRecent] = useState(false);

  // Editing state
  const ep = useEditPanel<Snippet>();
  const folderEp = useEditPanel<Folder>();
  const editingFolder = folderEp.editing !== null && folderEp.editing !== "new" ? folderEp.editing : null;

  const snippetIsDirtyRef = useRef(false);
  const formSessionKeyRef = useRef<string>("__new__");
  const openSnippet = useCallback((item: Snippet | "new") => {
    snippetIsDirtyRef.current = false;
    formSessionKeyRef.current = item === "new" ? `new-${Date.now()}` : item.id;
    ep.openEdit(item);
  }, [ep.openEdit]);

  useEffect(() => {
    if (snippetsPendingAction?.action === "create") {
      openSnippet("new");
      setSnippetsPendingAction(null);
    }
  }, [snippetsPendingAction, openSnippet, setSnippetsPendingAction]);
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
    sessionIds: string[];
  } | null>(null);


  const scopedFolders = useMemo(
    () => folders.filter((f) => {
      const fvid = f.vault_id ?? "personal";
      return accessibleVaultIds.length === 0 || accessibleVaultIds.includes(fvid);
    }),
    [folders, accessibleVaultIds],
  );

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
  } = useFolderNavigation(scopedFolders);

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

  const isPinnedFn = useEffectivePinnedPredicate();
  const favorites = useMemo(
    () => (!hasSearch && !activeFolderId) ? filtered.filter((s) => isPinnedFn(s, "snippet")) : [],
    [filtered, hasSearch, activeFolderId, isPinnedFn],
  );
  const scopedRecentEntries = useMemo(
    () => selectRecentSnippetEntries(recentEntries, filtered),
    [recentEntries, filtered],
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

  usePageBulkActions({
    navItem: "snippets",
    filteredIds,
    selectedIdSet,
    setSelection,
    onDelete: (ids) => setConfirmDeleteIds(ids),
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
    const selectedSnippetFolderIds = selectedFolders.map((f) => f.id);
    const { isObjectSynced } = useSyncPrefsStore.getState();
    const allSynced = selectedSnippets.every((s) => isObjectSynced(s.id, "snippet"));
    const allCanEdit = selectedSnippets.every((s) => can("EDIT_SNIPPETS", s.vault_id ?? "personal"));
    const bulkVaultChildren = (operation: TransferOperation): ContextMenuItem[] => vaultOptions
      .filter((v) => [...selectedSnippets.map((s) => s.vault_id ?? "personal"), ...selectedFolders.map((f) => f.vault_id ?? "personal")].some((sourceVaultId) => sourceVaultId !== v.id))
      .filter((v) => buildTeamVaultTransferPlan({
        operation,
        targetVaultId: v.id,
        selected: { snippetIds: selectedSnippets.map((s) => s.id), snippetFolderIds: selectedSnippetFolderIds },
        can: (permission, vaultId) => can(permission, vaultId),
        connections: [],
        identities: [],
        keys: [],
        folders: [],
        snippets,
        snippetFolders: folders,
      }).allowed)
      .map((v) => ({
        label: v.name,
        icon: operation === "move" ? "lucide:vault" : "lucide:copy-plus",
        onClick: () => {
          if (operation === "move") {
            for (const folder of selectedFolders) void handleMoveFolderToVault(folder, v.id);
            for (const snippet of selectedSnippets) void handleMoveToVault(snippet, v.id);
          } else {
            for (const folder of selectedFolders) void handleCopyFolderToVault(folder, v.id);
            for (const snippet of selectedSnippets) void handleCopyToVault(snippet, v.id);
          }
        },
      }));
    const moveChildren = bulkVaultChildren("move");
    const copyChildren = bulkVaultChildren("copy");
    return [
      ...(allCanEdit ? [{
        label: `Duplicate ${ids.length} snippets`,
        icon: "lucide:copy",
        onClick: () => { void Promise.all(selectedSnippets.map((s) => handleDuplicate(s))); },
      }] : []),
      ...(moveChildren.length > 0 ? [{
        label: `Move ${ids.length} item${ids.length === 1 ? "" : "s"} to`,
        icon: "lucide:vault",
        children: moveChildren,
        divider: true,
      }] : []),
      ...(copyChildren.length > 0 ? [{
        label: `Copy ${ids.length} item${ids.length === 1 ? "" : "s"} to`,
        icon: "lucide:copy-plus",
        children: copyChildren,
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
        label: `Export ${ids.length} snippet${ids.length === 1 ? "" : "s"}`,
        icon: "lucide:upload",
        onClick: () => useUIStore.getState().openImportExport("export", { bulk: { snippets: ids } }),
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
  }, [selectedIdSet, viewSnippets, selectedFolders, excludedIds, syncTypes, can, vaultOptions, snippets, folders]);

  // ── Injection ────────────────────────────────────────────────────────────

  function recordExecution(snippet: Snippet, execute: boolean, targets: RecentTarget[]) {
    if (targets.length === 0) return;
    addRecentEntry({ snippetId: snippet.id, targets, execute, timestamp: Date.now() });
  }

  async function handleTrigger(snippet: Snippet, execute: boolean, sessionIds: string[]) {
    const allSessions = useSessionStore.getState().sessions;
    const targetSessions = sessionIds
      .map((id) => allSessions.find((s) => s.id === id))
      .filter((s) => s && s.type !== "multiplayer") as typeof allSessions;
    if (targetSessions.length === 0) return;
    trackUsed(snippet.id);

    let clipboard = "";
    try { clipboard = await readClipboard(); } catch { /* permission denied */ }

    // Use the first session for dynamic variable resolution (host, user, etc.)
    const ctx = buildDynamicContext(targetSessions[0], connections, clipboard);
    const vars = parseVariables(snippet.content);
    const dynValues = buildDynamicValues(vars, ctx);
    const partialTemplate = resolveTemplate(snippet.content, dynValues);

    const userVars = vars.filter((v) => !v.dynamic);
    const initialValues = buildDefaultValues(userVars);
    const missing = userVars.filter((v) => needsUserInput(v));

    if (missing.length === 0) {
      const resolved = resolveTemplate(partialTemplate, initialValues);
      const payload = execute ? `${resolved}\n` : resolved;
      await Promise.all(
        targetSessions.map((s) => broadcastSnippetInject(s.id, s.type, payload, execute).catch(console.error)),
      );
      const targets: RecentTarget[] = targetSessions.map((s) => ({
        connectionId: s.connectionId,
        connectionName: s.connectionName,
        sessionType: s.type as "ssh" | "local" | "serial",
        localShell: s.localShell,
      }));
      recordExecution(snippet, execute, targets);
    } else {
      setPendingInject({ snippet, partialTemplate, userVars, initialValues, execute, sessionIds: targetSessions.map((s) => s.id) });
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
    const next = isPinnedFn(snippet, "snippet");
    await pinSnippet(snippet.id, !next);
  }

  async function handleReplay(entry: RecentSnippetExecution) {
    const snippet = snippets.find((s) => s.id === entry.snippetId);
    if (!snippet) return;

    const { sessions } = useSessionStore.getState();
    const resolvedSessionIds: string[] = [];
    const connectionIdsToOpen: string[] = [];
    let localShellPath: string | null = null;

    for (const target of entry.targets) {
      if (target.sessionType === "local") {
        const match = sessions.find((s) => s.type === "local" && s.status === "connected");
        if (match) resolvedSessionIds.push(match.id);
        else localShellPath = target.localShell ?? "";
      } else if (target.connectionId) {
        const match = sessions.find((s) => s.connectionId === target.connectionId && s.status === "connected");
        if (match) resolvedSessionIds.push(match.id);
        else connectionIdsToOpen.push(target.connectionId);
      }
    }

    if (resolvedSessionIds.length > 0) void handleTrigger(snippet, entry.execute, resolvedSessionIds);

    const connectionSessionIds = connectionIdsToOpen.length > 0
      ? await useSessionStore.getState().connectMany(connectionIdsToOpen).catch(() => [] as string[])
      : [];
    const localSessionId = localShellPath !== null
      ? useSessionStore.getState().beginLocalSession(localShellPath || undefined)
      : null;
    const newSessionIds = localSessionId ? [...connectionSessionIds, localSessionId] : connectionSessionIds;

    const allSessionIds = [...resolvedSessionIds, ...newSessionIds];
    if (allSessionIds.length === 0) return;

    useUIStore.getState().setActiveNav("terminal");
    if (allSessionIds.length === 1) {
      useSessionStore.getState().setActive(allSessionIds[0]);
    } else {
      useLayoutStore.getState().openSessions(allSessionIds);
      useSessionStore.getState().setActive(allSessionIds[0]);
    }

    if (newSessionIds.length > 0) {
      void waitForConnectedSessionIds(
        newSessionIds,
        () => useSessionStore.getState().sessions,
        (listener) => useSessionStore.subscribe(listener),
      ).then((connectedIds) => {
        const validIds = connectedIds.filter(Boolean) as string[];
        if (validIds.length > 0) void handleTrigger(snippet, entry.execute, validIds);
      });
    }
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
    const canEdit = can("EDIT_SNIPPETS", svid);
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
        onInsert={(sessionIds) => void handleTrigger(s, false, sessionIds)}
        onExecute={(sessionIds) => void handleTrigger(s, true, sessionIds)}
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
        onPointerDown={(e) => handleDragStart(e, s.id)}
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
            onExport={() => useUIStore.getState().openImportExport("export", { bulk: { snippets: snippets.filter((s) => s.folder_id === editingFolder.id).map((s) => s.id) } })}
          />
        ) : ep.editing !== null ? (
          <SnippetForm
            key={`${formSessionKeyRef.current}-${snippetFormVersion}`}
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
            <SkeletonList />
          ) : snippets.length === 0 ? (
            <EmptyState onAdd={() => openSnippet("new")} />
          ) : (
            <div className="space-y-6">

              {/* ── Breadcrumb (when inside a folder) ── */}
              {folderPath.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    className="flex items-center gap-1.5 text-xs transition-colors text-(--t-text-dim) hover:text-(--t-text-primary)"
                    onClick={navigateToRoot}
                  >
                    <Icon icon="lucide:chevron-left" width={13} />
                    All Snippets
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

              {/* ── Recent executions (root only) ── */}
              {!hasSearch && !activeFolderId && scopedRecentEntries.length > 0 && (
                <div
                  className="rounded-2xl p-3"
                  style={{ border: "1px solid var(--t-border)" }}
                >
                  <div className="flex items-center justify-between mb-2.5 px-1">
                    <div className="flex items-center gap-1.5">
                      <Icon icon="lucide:history" width={12} className="text-(--t-text-dim)" />
                      <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
                        Recent
                      </p>
                    </div>
                    <button
                      onClick={() => { useSnippetRecentStore.getState().clear(); setShowAllRecent(false); }}
                      className="text-xs text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                  <div
                    className={layoutMode === "grid" ? "grid gap-4" : "flex flex-col gap-1"}
                    style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" } : undefined}
                  >
                    {(showAllRecent ? scopedRecentEntries : scopedRecentEntries.slice(0, RECENT_PREVIEW_COUNT)).map((entry) => (
                      <RecentCard
                        key={entry.id}
                        entry={entry}
                        layout={layoutMode}
                        snippet={snippets.find((s) => s.id === entry.snippetId)}
                        onReplay={() => void handleReplay(entry)}
                        onRemove={() => removeRecentEntry(entry.id)}
                      />
                    ))}
                  </div>
                  {scopedRecentEntries.length > RECENT_PREVIEW_COUNT && (
                    <button
                      onClick={() => setShowAllRecent((v) => !v)}
                      className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
                      style={{ background: "var(--t-bg-elevated)" }}
                    >
                      <Icon icon={showAllRecent ? "lucide:chevron-up" : "lucide:chevron-down"} width={12} />
                      {showAllRecent ? "Show less" : `Show ${scopedRecentEntries.length - RECENT_PREVIEW_COUNT} more`}
                    </button>
                  )}
                </div>
              )}

              {/* ── Pinned (root only) ── */}
              {favorites.length > 0 && (
                <div>
                  <SectionHeader label="Pinned" count={favorites.length} />
                  <div className={layoutMode === "grid" ? "grid gap-4" : "flex flex-col gap-1"} style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" } : undefined}>{favorites.map(renderCard)}</div>
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
                        onPointerDown={(e) => handleFolderDragStart(e, folder.id)}
                        {...folderDropProps(folder.id)}
                        vaults={vaultOptions.filter((v) => v.id !== (folder.vault_id ?? "personal"))}
                        onMoveToVault={(vaultId) => void handleMoveFolderToVault(folder, vaultId)}
                        onCopyToVault={(vaultId) => void handleCopyFolderToVault(folder, vaultId)}
                        onExport={() => useUIStore.getState().openImportExport("export", { bulk: { snippets: snippets.filter((s) => s.folder_id === folder.id).map((s) => s.id) } })}
                        bulkContextMenuItems={selectedIdSet.size > 1 ? bulkContextMenuItems : undefined}
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
                  {!hasSearch && (visibleFolders.length > 0 || favorites.length > 0 || activeFolderId) && (
                    <SectionHeader
                      label={activeFolderId ? "Snippets" : "Other"}
                      count={viewSnippets.length}
                    />
                  )}
                  <div className={layoutMode === "grid" ? "grid gap-4" : "flex flex-col gap-1"} style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" } : undefined}>{viewSnippets.map(renderCard)}</div>
                </div>
              ) : !hasSearch && filtered.length > 0 && activeFolderId ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Icon icon="lucide:folder-open" width={32} className="text-(--t-text-dim)" />
                  <p className="text-sm text-(--t-text-dim)">This folder is empty</p>
                  <button
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-(--t-bg-elevated) text-(--t-accent) border border-(--t-border-hover)"
                    onClick={() => openSnippet("new")}
                  >
                    <Icon icon="lucide:plus" width={12} />
                    Add Snippet
                  </button>
                </div>
              ) : hasSearch && filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Icon icon="lucide:search-x" width={28} className="text-(--t-text-dim)" />
                  <p className="text-sm text-(--t-text-dim)">No snippets match "{search}"</p>
                  <button
                    onClick={() => setSearch("")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-(--t-bg-elevated) text-(--t-text-secondary) border border-(--t-border-hover)"
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
                  >
                    <Icon icon="lucide:x" width={11} />
                    Clear search
                  </button>
                </div>
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
        title={`Delete ${confirmDeleteIds.length} item${confirmDeleteIds.length === 1 ? "" : "s"}`}
        message={`Are you sure you want to delete ${confirmDeleteIds.length} item${confirmDeleteIds.length === 1 ? "" : "s"}? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          for (const id of confirmDeleteIds) {
            const folder = folders.find((f) => f.id === id);
            if (folder) void handleDeleteFolder(folder);
            else void deleteSnippet(id);
          }
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
          const allSessions = useSessionStore.getState().sessions;
          const targetSessions = pendingInject.sessionIds
            .map((id) => allSessions.find((s) => s.id === id))
            .filter(Boolean) as typeof allSessions;
          if (targetSessions.length === 0) return;
          const payload = execute ? `${resolvedText}\n` : resolvedText;
          await Promise.all(
            targetSessions.map((s) => broadcastSnippetInject(s.id, s.type, payload, execute).catch(console.error)),
          );
          const targets: RecentTarget[] = targetSessions.map((s) => ({
            connectionId: s.connectionId,
            connectionName: s.connectionName,
            sessionType: s.type as "ssh" | "local" | "serial",
            localShell: s.localShell,
          }));
          recordExecution(pendingInject.snippet, execute, targets);
          setPendingInject(null);
        }}
        onClose={() => setPendingInject(null)}
      />
    )}
    </>
  );
}
