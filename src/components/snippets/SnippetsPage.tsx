import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Icon } from "@iconify/react";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { usePermissions, type Permission } from "@/hooks/usePermission";
import { useAccessibleVaultIds, useScopedVaultId } from "@/hooks/useAccessibleVaultIds";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { usePageBulkActions } from "@/hooks/usePageBulkActions";
import { useDragToFolder } from "@/hooks/useDragToFolder";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { useEffectivePinnedPredicate } from "@/hooks/useEffectivePinned";
import { useAllSnippets } from "@/hooks/useAllSnippets";
import { useAllSnippetFolders } from "@/hooks/useAllSnippetFolders";
import { useAllConnections } from "@/hooks/useAllConnections";
import { DragSelectSurface } from "@/components/shared/DragSelectSurface";
import { BaseCard } from "@/components/shared/BaseCard";
import { waitForConnectedSessionIds } from "@/components/shared/sessionPickerTargets";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import {
  parseVariables,
  needsUserInput,
} from "@/services/snippetParser";
import { snippetScriptText, snippetSearchText } from "@/services/snippetSteps";
import { runSnippetIntoSessions } from "@/services/snippetRun";
import { snippetToForm } from "@/utils/snippetForm";
import { usePageClipboard } from "@/hooks/usePageClipboard";
import { nameIsFree, folderNameIsFree } from "@/utils/cloneName";
import { useCrossVaultPasteConfirm } from "@/hooks/useCrossVaultPasteConfirm";
import { VaultCascadeModal } from "@/components/shared/VaultCascadeModal";
import { ClipboardPill } from "@/components/shared/ClipboardPill";
import { useVaultClipboardStore, type VaultClipboardKind } from "@/stores/vaultClipboardStore";
import { getShortcutHint } from "@/stores/shortcutStore";
import { SidePanelLayout } from "@/components/shared/SidePanelLayout";
import { useEditPanel } from "@/hooks/useEditPanel";
import { useSyncedFormKey } from "@/hooks/useSyncedFormKey";
import { SnippetsToolbar } from "./SnippetsToolbar";
import { CommunityBrowser } from "./community/CommunityBrowser";
import { ShareSnippetModal } from "./community/ShareSnippetModal";
import { SnippetCard } from "./SnippetCard";
import { SnippetForm } from "./SnippetForm";
import { FolderCard } from "@/components/folders/FolderCard";
import { FolderEditPanel } from "@/components/folders/FolderEditPanel";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import type { Snippet, Folder, SnippetFormData, Connection } from "@/types";
import type { SortMode } from "@/components/shared/ToolbarViewControls";
import { buildTeamVaultTransferPlan, type TransferOperation } from "@/services/teamVaultPermissions";
import { useSnippetRecentStore, type RecentSnippetExecution, type RecentTarget } from "@/stores/snippetRecentStore";
import { selectRecentSnippetEntries } from "@/utils/snippetRecent";
import { descendantFolders, itemsInFolderSubtree } from "@/utils/folderTree";
import { useVaultOptions } from "@/hooks/useVaultOptions";
import { useScopedFolders } from "@/hooks/useScopedFolders";
import { FolderBreadcrumb } from "@/components/folders/FolderBreadcrumb";
import { FolderEjectZone } from "@/components/folders/FolderEjectZone";
import { copyFolderSubtree } from "@/utils/folderCopy";

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
  if (s < 5) return i18n.t("snippets.page.relativeTime.justNow");
  if (s < 60) return i18n.t("snippets.page.relativeTime.secondsAgo", { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return i18n.t("snippets.page.relativeTime.minutesAgo", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return i18n.t("snippets.page.relativeTime.hoursAgo", { count: h });
  const d = Math.floor(h / 24);
  if (d < 7) return i18n.t("snippets.page.relativeTime.daysAgo", { count: d });
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
  const { t } = useTranslation();
  const isList = layout === "list";
  const label = snippet?.name ?? t("snippets.page.recent.deletedSnippet");
  const isDeleted = !snippet;
  const primaryTarget = entry.targets[0];
  const host = primaryTarget
    ? entry.targets.length > 1
      ? t("snippets.page.recent.targetMore", { name: primaryTarget.connectionName, count: entry.targets.length - 1 })
      : primaryTarget.connectionName
    : t("snippets.page.recent.unknownTarget");
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
      {entry.execute ? t("snippets.page.recent.modeRun") : t("snippets.page.recent.modeInsert")}
    </span>
  );

  const removeButton = (
    <button
      title={t("common.action.remove")}
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
      title={t("snippets.page.recent.replay")}
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
  const { t } = useTranslation();
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
        <span className="text-base font-semibold text-(--t-text-primary)">{t("snippets.page.emptyState.title")}</span>
        <span className="text-sm text-(--t-text-dim) max-w-[18rem]">
          {t("snippets.page.emptyState.subtitle")}
        </span>
      </div>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors bg-(--t-bg-elevated) text-(--t-accent) border border-(--t-border-hover)"
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
      >
        <Icon icon="lucide:plus" width={15} />
        {t("snippets.page.emptyState.cta")}
      </button>
    </div>
  );
}


// ─── Main page ────────────────────────────────────────────────────────────────

export function SnippetsPage() {
  const { t } = useTranslation();
  const { loading, loadSnippets, createSnippet, updateSnippet, deleteSnippet, pinSnippet } = useSnippetStore();
  const recentEntries = useSnippetRecentStore((s) => s.entries);
  const addRecentEntry = useSnippetRecentStore((s) => s.add);
  const removeRecentEntry = useSnippetRecentStore((s) => s.remove);
  const snippets = useAllSnippets();
  const { loadFolders, saveFolder, updateFolder, deleteFolder, moveFolder } = useSnippetFolderStore();
  const folders = useAllSnippetFolders();
  const { sessions, activeSessionId } = useSessionStore();
  const connections = useAllConnections();
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const layoutMode = useUIStore((s) => s.snippetsLayoutMode);
  const setLayoutMode = useUIStore((s) => s.setSnippetsLayoutMode);
  const snippetsPendingAction = useUIStore((s) => s.snippetsPendingAction);
  const setSnippetsPendingAction = useUIStore((s) => s.setSnippetsPendingAction);

  // Vault & permissions
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const accessibleVaultIds = useAccessibleVaultIds();
  const scopedVaultId = useScopedVaultId();
  const can = usePermissions();

  const vaultOptions = useVaultOptions();

  const canCreate = selectedVaultIds.some((vid) => can("EDIT_SNIPPETS", vid));

  // Sync prefs (reactive)
  const excludedIds = useSyncPrefsStore((s) => s.excludedIds);
  const syncTypes = useSyncPrefsStore((s) => s.syncTypes);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeConn = connections.find((c) => c.id === activeSession?.connectionId);

  const [tab, setTab] = useState<"mine" | "community">("mine");
  const [search, setSearch] = useState("");
  const [communitySearch, setCommunitySearch] = useState("");
  const [sharing, setSharing] = useState<{ snippets: Snippet[]; packName?: string } | null>(null);
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


  const scopedFolders = useScopedFolders(folders, accessibleVaultIds);

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
        snippetSearchText(s).toLowerCase().includes(q) ||
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

  // ── Cut / copy / paste ────────────────────────────────────────────────────

  const clipboard = useVaultClipboardStore((s) => s.clipboard);
  const cutIds = useMemo(
    () =>
      new Set(
        clipboard?.tab === "snippets" && clipboard.mode === "cut"
          ? [...clipboard.items.map((i) => i.id), ...clipboard.folderIds]
          : [],
      ),
    [clipboard],
  );

  const crossVaultPaste = useCrossVaultPasteConfirm();

  /**
   * The destination folder is the only unambiguous carrier of a destination vault.
   * At the root there is none, so nothing migrates and every object keeps its own
   * vault — matching the drag-to-root path, and avoiding a "move to top level"
   * gesture silently pulling a subtree out of a team vault. Derived from the folder
   * argument rather than activeFolderId so an undo, which passes the origin folder
   * back in, migrates back to the vault it came from.
   */
  /**
   * A destination folder carries its own vault. At the root there is none, so the
   * view's scope answers instead: with a single vault on screen its root IS that
   * vault's root and a paste there belongs in it. With several on screen the root
   * names no destination, so every object keeps its own vault.
   */
  const vaultForFolder = (folderId: string | null): string | null =>
    folderId ? (scopedFolders.find((f) => f.id === folderId)?.vault_id ?? null) : scopedVaultId;

  // Every mutation below goes through a store method so vault permission checks apply.
  // Snippets own no secrets, so nothing has to be republished on a cross-vault write.
  usePageClipboard({
    navItem: "snippets",
    getSelection: () => [...selectedIdSet],
    getFocusedId: () => focusedId,
    classify: (id) =>
      scopedFolders.some((f) => f.id === id)
        ? "folder"
        : snippets.some((s) => s.id === id)
        ? "snippet"
        : null,
    exists: (id) => snippets.some((s) => s.id === id) || scopedFolders.some((f) => f.id === id),
    vaultIdOf: (id) =>
      snippets.find((s) => s.id === id)?.vault_id
      ?? scopedFolders.find((f) => f.id === id)?.vault_id
      ?? "personal",
    targetFolderId: () => activeFolderId,
    rootVaultIds: () => accessibleVaultIds,
    targetVaultId: () => vaultForFolder(activeFolderId),
    targetVaultName: () =>
      vaultOptions.find((v) => v.id === vaultForFolder(activeFolderId))?.name ?? "",
    confirmCrossVault: crossVaultPaste.confirmCrossVault,
    folderIdOf: (id) =>
      snippets.find((s) => s.id === id)?.folder_id
      ?? scopedFolders.find((f) => f.id === id)?.parent_folder_id
      ?? null,
    folderContentKinds: (folderId): VaultClipboardKind[] =>
      getSnippetsInFolderTree(folderId).length > 0 ? ["snippet"] : [],
    // A snippet-call step points at another snippet by id. Moving the caller without
    // the callee leaves the call unresolvable from the destination vault. As on Port
    // Forwarding this cannot be a permission — both sides are EDIT_SNIPPETS. A callee
    // travelling in the same paste is fine, so it is excluded first.
    danglingKinds: (items, folderIds, destination): VaultClipboardKind[] => {
      const moved = [
        ...items.map((i) => snippets.find((s) => s.id === i.id)).filter((s) => !!s),
        ...folderIds.flatMap((id) => getSnippetsInFolderTree(id)),
      ];
      const movedIds = new Set(moved.map((s) => s.id));
      const callees = moved
        .flatMap((s) => s.steps)
        .filter((step) => step.kind === "snippet")
        .map((step) => step.snippet_id)
        .filter((id) => !movedIds.has(id))
        .map((id) => snippets.find((s) => s.id === id))
        .filter((s) => !!s);
      return callees.some((s) => (s.vault_id ?? "personal") !== destination) ? ["snippet"] : [];
    },
    canMoveFolder: (id, parentFolderId) =>
      parentFolderId !== id
      && !(parentFolderId !== null && getAllSubFolders(id).some((f) => f.id === parentFolderId)),
    can: (permission, vaultId) => can(permission as Permission, vaultId),
    // A cross-vault move carries vault_id alongside folder_id, otherwise the snippet
    // would keep a stale vault_id next to its new folder's.
    moveItems: async (ids, folderId, vaultId) => {
      for (const id of ids) {
        const s = snippets.find((x) => x.id === id);
        if (!s) continue;
        await updateSnippet(id, {
          ...snippetToForm(s),
          folder_id: folderId ?? undefined,
          vault_id: vaultId ?? s.vault_id,
        });
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
      const created: string[] = [];
      for (const id of ids) {
        const s = snippets.find((x) => x.id === id);
        if (!s) continue;
        created.push((await duplicateSnippetInto(s, folderId, {
          vaultId: targetVault,
          keepName: nameIsFree(snippets, s.name, targetVault ?? s.vault_id ?? "personal", folderId),
        })).id);
      }
      return created;
    },
    duplicateFolder: async (id, parentFolderId) => {
      const targetVault = vaultForFolder(parentFolderId);
      const folder = scopedFolders.find((f) => f.id === id);
      return (
        await copyFolderInto(id, parentFolderId, targetVault ?? undefined, {
          keepName: folderNameIsFree(
            scopedFolders,
            folder?.name,
            targetVault ?? folder?.vault_id ?? "personal",
            parentFolderId,
          ),
        })
      ).id;
    },
    deleteItems: async (ids) => { for (const id of ids) await deleteSnippet(id); },
    deleteFolder: async (id) => { await deleteFolder(id); },
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
        label: t("snippets.page.bulk.duplicateSnippets", { count: ids.length }),
        icon: "lucide:copy",
        onClick: () => { void Promise.all(selectedSnippets.map((s) => handleDuplicate(s))); },
      }] : []),
      ...(moveChildren.length > 0 ? [{
        label: t("snippets.page.bulk.moveItemsTo", { count: ids.length }),
        icon: "lucide:vault",
        children: moveChildren,
        divider: true,
      }] : []),
      ...(copyChildren.length > 0 ? [{
        label: t("snippets.page.bulk.copyItemsTo", { count: ids.length }),
        icon: "lucide:copy-plus",
        children: copyChildren,
      }] : []),
      {
        label: allSynced ? t("snippets.page.bulk.disableCloudSync", { count: ids.length }) : t("snippets.page.bulk.enableCloudSync", { count: ids.length }),
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
        label: t("snippets.page.bulk.exportSnippets", { count: ids.length }),
        icon: "lucide:upload",
        onClick: () => useUIStore.getState().openImportExport("export", { bulk: { snippets: ids } }),
      },
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
      {
        label: t("snippets.page.bulk.deleteSnippets", { count: ids.length }),
        icon: "lucide:trash-2",
        onClick: () => setConfirmDeleteIds(ids),
        danger: true,
        divider: true,
      },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdSet, viewSnippets, selectedFolders, excludedIds, syncTypes, can, vaultOptions, snippets, folders, t]);

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

    // The prompt goes to the global modal: the session picker navigates to the
    // terminal, which unmounts this page before a local modal could be seen.
    const ran = await runSnippetIntoSessions(snippet, targetSessions.map((s) => s.id), execute, {
      onNeedVars: (p) => useSnippetStore.getState().setGlobalPendingInject(p),
    });

    // Record recents only for the direct (no-modal) path; the modal path records on submit.
    const noUserInputNeeded = parseVariables(snippetScriptText(snippet))
      .filter((v) => !v.dynamic)
      .every((v) => !needsUserInput(v));
    if (ran && noUserInputNeeded) {
      const targets: RecentTarget[] = targetSessions.map((s) => ({
        connectionId: s.connectionId,
        connectionName: s.connectionName,
        sessionType: s.type as "ssh" | "local" | "serial",
        localShell: s.localShell,
      }));
      recordExecution(snippet, execute, targets);
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
      steps: snippet.steps,
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

  /** All folders in the subtree rooted at folderId (BFS-ordered, parents before children). */
  function getAllSubFolders(folderId: string): Folder[] {
    return descendantFolders(folders, folderId);
  }

  function getSnippetsInFolderTree(folderId: string): Snippet[] {
    return itemsInFolderSubtree(snippets, folders, folderId);
  }

  /** Warns about the cascade: subfolders and every snippet nested under them go too. */
  function folderDeleteMessage(folderId: string): string {
    const count = getSnippetsInFolderTree(folderId).length;
    return count === 0
      ? t("snippets.page.confirmDeleteFolder.messageEmpty")
      : t("snippets.page.confirmDeleteFolder.message", { count });
  }

  /** A selection that includes folders drags their contents down with it. */
  function bulkDeleteMessage(ids: string[]): string {
    const base = t("snippets.page.confirmDelete.message", { count: ids.length });
    const nested = new Set(
      ids
        .filter((id) => folders.some((f) => f.id === id))
        .flatMap((id) => getSnippetsInFolderTree(id).map((s) => s.id)),
    );
    for (const id of ids) nested.delete(id);
    return nested.size === 0
      ? base
      : `${base} ${t("snippets.page.confirmDelete.folderCascade", { count: nested.size })}`;
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
      const folderIdMap = await copyFolderSubtree({
        root: folder, subFolders, vaultId, existingFolders: folders, saveFolder,
      });
      const newRootId = folderIdMap.get(folder.id)!;
      for (const s of treeSnippets) {
        const newFolderId = s.folder_id ? (folderIdMap.get(s.folder_id) ?? newRootId) : newRootId;
        const destHasSnippetName = snippets.some((x) => (x.vault_id ?? "personal") === vaultId && x.name === s.name);
        await createSnippet({ ...snippetToForm(s), name: destHasSnippetName ? `${s.name} (copy)` : s.name, folder_id: newFolderId, vault_id: vaultId, favorite: false });
      }
    } catch (err) { console.error(err); }
  }

  // ── Clipboard paste helpers ───────────────────────────────────────────────

  /**
   * Duplicates `snippet` into `folderId`, optionally into another vault. `keepName`
   * is for members of a subtree being cloned wholesale — only the root of such a
   * clone carries the "(copy)" suffix.
   */
  async function duplicateSnippetInto(
    snippet: Snippet,
    folderId: string | null,
    opts: { vaultId?: string; keepName?: boolean } = {},
  ) {
    return createSnippet({
      ...snippetToForm(snippet),
      // default name suffix kept in English until all creation sites are localized together (see i18n issue #14)
      name: opts.keepName ? snippet.name : `${snippet.name} (copy)`,
      folder_id: folderId ?? undefined,
      vault_id: opts.vaultId ?? snippet.vault_id,
      favorite: false,
    });
  }

  /** Deep-clones a folder subtree under `parentFolderId`, into `vaultId` when given. */
  async function copyFolderInto(folderId: string, parentFolderId: string | null, vaultId?: string, opts: { keepName?: boolean } = {}) {
    const folder = scopedFolders.find((f) => f.id === folderId);
    if (!folder) throw new Error(`Unknown folder ${folderId}`);
    const targetVaultId = vaultId ?? folder.vault_id;
    // Only the root of the clone is renamed; renaming every descendant would
    // compound to "Prod (copy) (copy)" on a second paste.
    const root = await saveFolder({
      name: opts.keepName ? folder.name : `${folder.name} (copy)`,
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
    for (const s of getSnippetsInFolderTree(folder.id)) {
      await duplicateSnippetInto(s, folderIdMap.get(s.folder_id ?? "") ?? root.id, {
        vaultId: targetVaultId,
        keepName: true,
      });
    }
    return root;
  }

  /** Moves a folder subtree into `vaultId`, reparenting the root at the same time. */
  async function migrateFolderTreeToVault(
    folder: Folder,
    parentFolderId: string | null,
    vaultId: string,
  ) {
    await updateFolder(folder.id, {
      name: folder.name,
      object_type: folder.object_type,
      parent_folder_id: parentFolderId ?? undefined,
      vault_id: vaultId,
    });
    for (const sf of getAllSubFolders(folder.id)) {
      await updateFolder(sf.id, { name: sf.name, object_type: sf.object_type, parent_folder_id: sf.parent_folder_id, vault_id: vaultId });
    }
    for (const s of getSnippetsInFolderTree(folder.id)) {
      await updateSnippet(s.id, { ...snippetToForm(s), vault_id: vaultId });
    }
  }

  async function handleCreateFolder() {
    ep.closeEdit();
    const folder = await saveFolder({
      name: "New Folder" /* persisted English default; menu label is localized */,
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
        onShare={() => setSharing({ snippets: [s] })}
        folders={folders}
        isEditing={ep.isEditing(s)}
        isSelected={selectedIdSet.has(s.id)}
        isFocused={focusedId === s.id}
        dimmed={!isContextuallyRelevant(s, activeConn) || cutIds.has(s.id)}
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
        tab={tab}
        onTabChange={setTab}
        search={tab === "community" ? communitySearch : search}
        onSearchChange={tab === "community" ? setCommunitySearch : setSearch}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        onNewSnippet={() => openSnippet("new")}
        onNewFolder={() => void handleCreateFolder()}
      />

      {tab === "community" ? (
        <div className="flex-1 min-h-0 px-9 pt-5 pb-9 flex flex-col">
          <CommunityBrowser search={communitySearch} layout={layoutMode} onInstalled={() => setTab("mine")} />
        </div>
      ) : (
      <>

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
              <FolderBreadcrumb
                path={folderPath}
                rootLabel={t("snippets.page.allSnippets")}
                onNavigateToRoot={navigateToRoot}
                onNavigateTo={navigateTo}
              />

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
                        {t("snippets.page.recent.title")}
                      </p>
                    </div>
                    <button
                      onClick={() => { useSnippetRecentStore.getState().clear(); setShowAllRecent(false); }}
                      className="text-xs text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
                    >
                      {t("snippets.page.recent.clear")}
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
                      {showAllRecent ? t("snippets.page.recent.showLess") : t("snippets.page.recent.showMore", { count: scopedRecentEntries.length - RECENT_PREVIEW_COUNT })}
                    </button>
                  )}
                </div>
              )}

              {/* ── Pinned (root only) ── */}
              {favorites.length > 0 && (
                <div>
                  <SectionHeader label={t("snippets.page.pinned")} count={favorites.length} />
                  <div className={layoutMode === "grid" ? "grid gap-4" : "flex flex-col gap-1"} style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" } : undefined}>{favorites.map(renderCard)}</div>
                </div>
              )}

              {/* ── Folders ── */}
              {visibleFolders.length > 0 && (
                <div>
                  <SectionHeader label={t("snippets.page.folders")} />
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
                        dimmed={cutIds.has(folder.id)}
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
                        onShare={() => setSharing({ snippets: snippets.filter((s) => s.folder_id === folder.id && !s.deleted_at), packName: folder.name })}
                        bulkContextMenuItems={selectedIdSet.size > 1 ? bulkContextMenuItems : undefined}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ── Eject drop zone (inside folder, visible only while dragging) ── */}
              {activeFolderId && (
                <FolderEjectZone
                  label={ejectTargetFolderId
                    ? t("snippets.page.ejectMoveTo", { name: folderPath[folderPath.length - 2].name })
                    : t("snippets.page.ejectRemoveFromFolder")}
                  isDragging={isDragging}
                  dragOver={dragOverEject}
                  dropProps={ejectDropProps(ejectTargetFolderId)}
                />
              )}

              {/* ── Snippets in current view ── */}
              {viewSnippets.length > 0 ? (
                <div>
                  {!hasSearch && (visibleFolders.length > 0 || favorites.length > 0 || activeFolderId) && (
                    <SectionHeader
                      label={activeFolderId ? t("snippets.page.snippetsSection") : t("snippets.page.other")}
                      count={viewSnippets.length}
                    />
                  )}
                  <div className={layoutMode === "grid" ? "grid gap-4" : "flex flex-col gap-1"} style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" } : undefined}>{viewSnippets.map(renderCard)}</div>
                </div>
              ) : !hasSearch && filtered.length > 0 && activeFolderId ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Icon icon="lucide:folder-open" width={32} className="text-(--t-text-dim)" />
                  <p className="text-sm text-(--t-text-dim)">{t("snippets.page.folderEmpty")}</p>
                  <button
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-(--t-bg-elevated) text-(--t-accent) border border-(--t-border-hover)"
                    onClick={() => openSnippet("new")}
                  >
                    <Icon icon="lucide:plus" width={12} />
                    {t("snippets.page.addSnippet")}
                  </button>
                </div>
              ) : hasSearch && filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Icon icon="lucide:search-x" width={28} className="text-(--t-text-dim)" />
                  <p className="text-sm text-(--t-text-dim)">{t("snippets.page.noSearchResults", { search })}</p>
                  <button
                    onClick={() => setSearch("")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-(--t-bg-elevated) text-(--t-text-secondary) border border-(--t-border-hover)"
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
                  >
                    <Icon icon="lucide:x" width={11} />
                    {t("snippets.page.clearSearch")}
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
            ...(canCreate ? [{ label: t("snippets.toolbar.newSnippet"), icon: "lucide:braces", onClick: () => openSnippet("new") } as const] : []),
            { label: t("snippets.toolbar.newFolder"), icon: "lucide:folder-plus", onClick: () => void handleCreateFolder() },
            ...(useVaultClipboardStore.getState().clipboard?.tab === "snippets"
              ? [{ label: t("common.action.paste"), icon: "lucide:clipboard", shortcut: getShortcutHint("paste"), onClick: () => window.dispatchEvent(new CustomEvent("voltius:clipboard-paste")) } as const]
              : []),
          ]}
        />
      )}
      </>
      )}
    </SidePanelLayout>

    <ClipboardPill navItem="snippets" />

    {/* ── Confirm folder delete ── */}
    {sharing && (
      <ShareSnippetModal
        snippets={sharing.snippets}
        packName={sharing.packName}
        onClose={() => setSharing(null)}
      />
    )}

    {confirmDeleteFolder && (
      <ConfirmModal
        title={t("snippets.page.confirmDeleteFolder.title", { name: confirmDeleteFolder.name })}
        message={folderDeleteMessage(confirmDeleteFolder.id)}
        confirmLabel={t("snippets.page.confirmDeleteFolder.confirmLabel")}
        onConfirm={() => void handleDeleteFolder(confirmDeleteFolder)}
        onCancel={() => setConfirmDeleteFolder(null)}
      />
    )}

    {/* ── Confirm bulk delete ── */}
    {confirmDeleteIds && (
      <ConfirmModal
        title={t("snippets.page.confirmDelete.title", { count: confirmDeleteIds.length })}
        message={bulkDeleteMessage(confirmDeleteIds)}
        confirmLabel={t("common.action.delete")}
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

    {crossVaultPaste.pending && (
      <VaultCascadeModal
        cascade={crossVaultPaste.pending}
        onConfirm={crossVaultPaste.accept}
        onCancel={crossVaultPaste.cancel}
      />
    )}
    </>
  );
}
