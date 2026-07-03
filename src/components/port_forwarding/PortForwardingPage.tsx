import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "@iconify/react";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useAllPortForwardingRules } from "@/hooks/useAllPortForwardingRules";
import { useUIStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { usePermissions } from "@/hooks/usePermission";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { useDefaultVaultId } from "@/hooks/useWritableVaultIds";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { usePageBulkActions } from "@/hooks/usePageBulkActions";
import { useDragToFolder } from "@/hooks/useDragToFolder";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { useFolderStore } from "@/stores/folderStore";
import { useAllFolders } from "@/hooks/useAllFolders";
import { useVaultCascade } from "@/hooks/useVaultCascade";
import { SidePanelLayout } from "@/components/shared/SidePanelLayout";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { VaultCascadeModal } from "@/components/shared/VaultCascadeModal";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { DragSelectSurface } from "@/components/shared/DragSelectSurface";
import { FolderCard } from "@/components/folders/FolderCard";
import { FolderEditPanel } from "@/components/folders/FolderEditPanel";
import { useSyncedFormKey } from "@/hooks/useSyncedFormKey";
import { useRuleTunnels } from "@/hooks/useRuleTunnels";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { PortForwardingToolbar } from "./PortForwardingToolbar";
import { ActiveTunnelsSection } from "./ActiveTunnelsSection";
import { RuleCard } from "./RuleCard";
import { RuleForm } from "./RuleForm";
import type { Folder, PortForwardingRule, PortForwardingRuleFormData, VaultOption } from "@/types";
import type { LayoutMode, SortMode } from "@/components/shared/ToolbarViewControls";

function sortRules(rules: PortForwardingRule[], mode: SortMode): PortForwardingRule[] {
  return [...rules].sort((a, b) => {
    switch (mode) {
      case "name-asc": return a.name.localeCompare(b.name);
      case "name-desc": return b.name.localeCompare(a.name);
      case "oldest": return a.created_at.localeCompare(b.created_at);
      case "newest":
      default: return b.created_at.localeCompare(a.created_at);
    }
  });
}

export function PortForwardingPage() {
  const { t } = useTranslation();
  const { loadRules, createRule, updateRule, deleteRule, duplicateRule, moveRuleFolder } =
    usePortForwardingStore();
  const rules = useAllPortForwardingRules();
  const { runningRuleCount, statusFor, startRule, stopRule } = useRuleTunnels();
  const { loadFolders, saveFolder, updateFolder, deleteFolder, moveFolder } = useFolderStore();
  const folders = useAllFolders();
  const { pending: cascadePending, request: requestCascade, confirm: confirmCascade, cancel: cancelCascade } = useVaultCascade();

  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const layoutMode = useUIStore((s) => s.portForwardingLayoutMode);
  const setLayoutMode = useUIStore((s) => s.setPortForwardingLayoutMode);
  const sortMode = useUIStore((s) => s.portForwardingSortMode);
  const setSortMode = useUIStore((s) => s.setPortForwardingSortMode);
  const pendingAction = useUIStore((s) => s.portForwardingPendingAction);
  const setPendingAction = useUIStore((s) => s.setPortForwardingPendingAction);

  const vaults = useVaultStore((s) => s.vaults);
  const accessibleVaultIds = useAccessibleVaultIds();
  const defaultVaultId = useDefaultVaultId();
  const can = usePermissions();

  const [search, setSearch] = useState("");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const editingRule = editingRuleId ? (rules.find((r) => r.id === editingRuleId) ?? null) : null;
  const [showForm, setShowForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  const ruleDirtyRef = useRef(false);
  const ruleFormSessionKeyRef = useRef<string>("new-rule");
  const ruleFormVersion = useSyncedFormKey(editingRule?.updated_at, showForm, () => ruleDirtyRef.current);

  const { pos: bgMenuPos, open: openBgMenu, close: closeBgMenu } = useContextMenu();

  useEffect(() => {
    void loadRules();
    void loadFolders();
  }, []);

  useEffect(() => {
    if (pendingAction?.action === "create") {
      ruleFormSessionKeyRef.current = `new-rule-${Date.now()}`;
      setEditingRuleId(null);
      setShowForm(true);
      setPendingAction(null);
    } else if (pendingAction?.action === "edit") {
      const rule = rules.find((r) => r.id === pendingAction.id) ?? null;
      ruleDirtyRef.current = false;
      ruleFormSessionKeyRef.current = rule?.id ?? `new-rule-${Date.now()}`;
      setEditingRuleId(rule?.id ?? null);
      setShowForm(true);
      setPendingAction(null);
    }
  }, [pendingAction]);

  const vaultOptions = useMemo<VaultOption[]>(
    () => [
      { id: "personal", name: "Personal" },
      ...vaults.filter((v) => v.id !== "personal").map((v) => ({ id: v.teamId ?? v.id, name: v.name })),
    ],
    [vaults],
  );

  const scopedFolders = useMemo(
    () => folders.filter((f) => {
      if (f.object_type !== "port_forwarding") return false;
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

  const q = useMemo(() => search.trim().toLowerCase(), [search]);

  const filtered = useMemo(() => {
    const accessible = rules.filter((r) => {
      const rvid = r.vault_id ?? "personal";
      if (accessibleVaultIds.length > 0 && !accessibleVaultIds.includes(rvid)) return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.description?.toLowerCase().includes(q) &&
          !String(r.local_port).includes(q) && !String(r.remote_port).includes(q)) return false;
      if (activeFolderId) return r.folder_id === activeFolderId;
      return scopedFolders.length === 0 || !r.folder_id || !scopedFolderIds.has(r.folder_id);
    });
    return sortRules(accessible, sortMode as SortMode);
  }, [rules, accessibleVaultIds, q, sortMode, activeFolderId, scopedFolders, scopedFolderIds]);

  const filteredIds = useMemo(
    () => [...visibleFolders.map((f) => f.id), ...filtered.map((r) => r.id)],
    [visibleFolders, filtered],
  );

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rules) if (r.folder_id) counts[r.folder_id] = (counts[r.folder_id] ?? 0) + 1;
    return counts;
  }, [rules]);

  function openNew() {
    ruleDirtyRef.current = false;
    ruleFormSessionKeyRef.current = `new-rule-${Date.now()}`;
    setEditingRuleId(null);
    setShowForm(true);
    setEditingFolderId(null);
  }

  function openEdit(rule: PortForwardingRule) {
    ruleDirtyRef.current = false;
    ruleFormSessionKeyRef.current = rule.id;
    setEditingRuleId(rule.id);
    setShowForm(true);
    setEditingFolderId(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingRuleId(null);
  }

  async function handleSave(data: PortForwardingRuleFormData) {
    if (editingRule) {
      await updateRule(editingRule.id, data);
    } else {
      const rule = await createRule(data);
      setEditingRuleId(rule.id);
    }
  }

  async function confirmDelete() {
    if (confirmDeleteId) {
      await deleteRule(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  }

  // ── Vault move / copy for rules ───────────────────────────────────────────

  const handleMoveRuleToVault = (rule: PortForwardingRule, vaultId: string) => {
    void updateRule(rule.id, {
      name: rule.name, local_port: rule.local_port, remote_port: rule.remote_port,
      remote_host: rule.remote_host, tunnel_type: rule.tunnel_type ?? "local",
      bind_host: rule.bind_host ?? "127.0.0.1", target_host: rule.target_host ?? "127.0.0.1",
      description: rule.description,
      connection_ids: rule.connection_ids, folder_id: rule.folder_id, vault_id: vaultId,
    });
  };

  const handleCopyRuleToVault = (rule: PortForwardingRule, vaultId: string) => {
    const destHasName = rules.some((r) => (r.vault_id ?? "personal") === vaultId && r.name === rule.name);
    void createRule({
      name: destHasName ? `${rule.name} (copy)` : rule.name,
      local_port: rule.local_port, remote_port: rule.remote_port,
      remote_host: rule.remote_host, tunnel_type: rule.tunnel_type ?? "local",
      bind_host: rule.bind_host ?? "127.0.0.1", target_host: rule.target_host ?? "127.0.0.1",
      description: rule.description,
      connection_ids: rule.connection_ids, folder_id: rule.folder_id, vault_id: vaultId,
    });
  };

  // ── Vault move / copy for folders ─────────────────────────────────────────

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

  const getRulesInFolderTree = (folderId: string): PortForwardingRule[] => {
    const ids = new Set([folderId, ...getAllSubFolders(folderId).map((f) => f.id)]);
    return rules.filter((r) => r.folder_id != null && ids.has(r.folder_id));
  };

  const handleMoveFolderToVault = (folder: Folder, vaultId: string) => {
    const subFolders = getAllSubFolders(folder.id);
    const treeRules = getRulesInFolderTree(folder.id);
    const targetVaultName = vaultOptions.find((v) => v.id === vaultId)?.name ?? vaultId;

    requestCascade({
      operation: "move",
      targetVaultName,
      description: t("portForwarding.page.vaultCascade.moveDescription", { folderName: folder.name, targetVaultName }),
      items: treeRules.map((r) => ({ type: "connection" as const, label: r.name })),
      execute: async () => {
        await updateFolder(folder.id, { name: folder.name, object_type: folder.object_type, parent_folder_id: folder.parent_folder_id, vault_id: vaultId });
        for (const sf of subFolders) {
          await updateFolder(sf.id, { name: sf.name, object_type: sf.object_type, parent_folder_id: sf.parent_folder_id, vault_id: vaultId });
        }
        for (const r of treeRules) {
          await updateRule(r.id, { name: r.name, local_port: r.local_port, remote_port: r.remote_port, remote_host: r.remote_host, tunnel_type: r.tunnel_type ?? "local", bind_host: r.bind_host ?? "127.0.0.1", target_host: r.target_host ?? "127.0.0.1", description: r.description, connection_ids: r.connection_ids, folder_id: r.folder_id, vault_id: vaultId });
        }
      },
    });
  };

  const handleCopyFolderToVault = (folder: Folder, vaultId: string) => {
    const subFolders = getAllSubFolders(folder.id);
    const treeRules = getRulesInFolderTree(folder.id);
    const targetVaultName = vaultOptions.find((v) => v.id === vaultId)?.name ?? vaultId;

    requestCascade({
      operation: "copy",
      targetVaultName,
      description: t("portForwarding.page.vaultCascade.copyDescription", { folderName: folder.name, targetVaultName }),
      items: treeRules.map((r) => ({ type: "connection" as const, label: r.name })),
      execute: async () => {
        const folderIdMap = new Map<string, string>();
        const destHasName = folders.some((f) => (f.vault_id ?? "personal") === vaultId && f.object_type === folder.object_type && f.name === folder.name);
        const newRoot = await saveFolder({ name: destHasName ? `${folder.name} (copy)` : folder.name, object_type: folder.object_type, parent_folder_id: folder.parent_folder_id, vault_id: vaultId });
        folderIdMap.set(folder.id, newRoot.id);
        for (const sf of subFolders) {
          const newParentId = sf.parent_folder_id ? (folderIdMap.get(sf.parent_folder_id) ?? newRoot.id) : newRoot.id;
          const newSf = await saveFolder({ name: sf.name, object_type: sf.object_type, parent_folder_id: newParentId, vault_id: vaultId });
          folderIdMap.set(sf.id, newSf.id);
        }
        for (const r of treeRules) {
          const newFolderId = r.folder_id ? (folderIdMap.get(r.folder_id) ?? newRoot.id) : newRoot.id;
          const destHasRule = rules.some((x) => (x.vault_id ?? "personal") === vaultId && x.name === r.name);
          await createRule({ name: destHasRule ? `${r.name} (copy)` : r.name, local_port: r.local_port, remote_port: r.remote_port, remote_host: r.remote_host, tunnel_type: r.tunnel_type ?? "local", bind_host: r.bind_host ?? "127.0.0.1", target_host: r.target_host ?? "127.0.0.1", description: r.description, connection_ids: r.connection_ids, folder_id: newFolderId, vault_id: vaultId });
        }
      },
    });
  };

  // ── Drag selection & keyboard nav ─────────────────────────────────────────

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
    layoutMode: layoutMode as "grid" | "list",
    onEnter: (id) => {
      const folder = visibleFolders.find((f) => f.id === id);
      if (folder) { navigateInto(folder); return; }
      const r = filtered.find((r) => r.id === id);
      if (r) openEdit(r);
    },
    onEdit: (id) => {
      const r = filtered.find((r) => r.id === id);
      if (r) openEdit(r);
    },
    onDuplicate: (id) => { void duplicateRule(id); },
    onEscape: () => {
      if (showForm || editingFolderId) { closeForm(); setEditingFolderId(null); }
      else if (activeFolderId) navigateToRoot();
      else setSelection([]);
    },
    onSearch: () => setOmniOpen(true),
    onBackspace: () => { if (activeFolderId) navigateToRoot(); },
  });

  useEffect(() => { setFocusedId(null); }, [activeFolderId]);

  const filteredRuleIdSet = useMemo(() => new Set(filtered.map((r) => r.id)), [filtered]);

  usePageBulkActions({
    navItem: "port-forwarding",
    filteredIds,
    selectedIdSet,
    setSelection,
    onDelete: (ids) => {
      const ruleIds = ids.filter((id) => filteredRuleIdSet.has(id));
      if (ruleIds.length > 0) setConfirmDeleteIds(ruleIds);
    },
  });

  // ── Drag-to-folder ────────────────────────────────────────────────────────

  const visibleFolderIds = useMemo(() => new Set(visibleFolders.map((f) => f.id)), [visibleFolders]);
  const canEdit = (vaultId: string) => can("EDIT_CONNECTIONS", vaultId);

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
      for (const id of ids) await moveRuleFolder(id, folderId);
      await loadRules();
    },
    onEject: async (ids, targetFolderId) => {
      for (const id of ids) await moveRuleFolder(id, targetFolderId);
      await loadRules();
    },
    onMoveFolders: async (folderDragIds, targetParentId) => {
      for (const id of folderDragIds) await moveFolder(id, targetParentId);
      await loadFolders();
    },
    onEjectFolders: async (folderDragIds, targetParentId) => {
      for (const id of folderDragIds) await moveFolder(id, targetParentId);
      await loadFolders();
    },
  });

  // ── Selection-aware delete & bulk context menu ────────────────────────────

  const selectedRules = useMemo(
    () => filtered.filter((r) => selectedIdSet.has(r.id)),
    [filtered, selectedIdSet],
  );

  const handleDeleteRule = useCallback((id: string) => {
    if (selectedIdSet.has(id) && selectedRules.length > 1) {
      setConfirmDeleteIds(selectedRules.map((r) => r.id));
    } else {
      setConfirmDeleteId(id);
    }
  }, [selectedIdSet, selectedRules]);

  const bulkContextMenuItems = useMemo<ContextMenuItem[] | undefined>(() => {
    if (selectedRules.length < 2) return undefined;
    const n = selectedRules.length;
    const allCanEdit = selectedRules.every((r) => canEdit(r.vault_id ?? "personal"));
    const sharedVaults = vaultOptions.filter((v) =>
      selectedRules.some((r) => (r.vault_id ?? "personal") !== v.id),
    );
    return [
      ...(allCanEdit ? [{
        label: t("portForwarding.page.bulk.duplicateRules", { count: n }),
        icon: "lucide:copy",
        onClick: () => { void Promise.all(selectedRules.map((r) => duplicateRule(r.id))); },
      }] : []),
      ...vaultMenuItems(
        allCanEdit ? sharedVaults : undefined,
        allCanEdit,
        sharedVaults.length > 0 ? (vaultId) => { for (const r of selectedRules) handleMoveRuleToVault(r, vaultId); } : undefined,
        sharedVaults.length > 0 ? (vaultId) => { for (const r of selectedRules) handleCopyRuleToVault(r, vaultId); } : undefined,
      ),
      {
        label: t("portForwarding.page.bulk.exportRules", { count: n }),
        icon: "lucide:upload",
        onClick: () => useUIStore.getState().openImportExport("export", { bulk: { portForwardingRules: selectedRules.map((r) => r.id) } }),
      },
      {
        label: t("portForwarding.page.bulk.deleteRules", { count: n }),
        icon: "lucide:trash-2",
        onClick: () => setConfirmDeleteIds(selectedRules.map((r) => r.id)),
        danger: true,
        divider: true,
      },
    ];
  }, [selectedRules, canEdit, vaultOptions, duplicateRule, handleMoveRuleToVault, handleCopyRuleToVault, t]);

  return (
    <>
    <SidePanelLayout
      panelOpen={showForm || editingFolder !== null}
      panelWidth={editingFolder !== null && !showForm ? 280 : 340}
      panel={
        <>
          {editingFolder !== null && !showForm && (
            <FolderEditPanel
              folder={editingFolder}
              onUpdate={(id, data) => void updateFolder(id, data)}
              onDelete={(f) => setConfirmDeleteFolderId(f.id)}
              onClose={() => setEditingFolderId(null)}
              vaults={vaultOptions.filter((v) => v.id !== (editingFolder.vault_id ?? "personal"))}
              canEdit={canEdit(editingFolder.vault_id ?? "personal")}
              onMoveToVault={(vaultId) => handleMoveFolderToVault(editingFolder, vaultId)}
              onCopyToVault={(vaultId) => handleCopyFolderToVault(editingFolder, vaultId)}
              onExport={() => useUIStore.getState().openImportExport("export", { bulk: { portForwardingRules: rules.filter((r) => r.folder_id === editingFolder.id).map((r) => r.id) } })}
            />
          )}
          {showForm && (
            <RuleForm
              key={`${ruleFormSessionKeyRef.current}-${ruleFormVersion}`}
              rule={editingRule}
              onSave={handleSave}
              onClose={closeForm}
              isDirtyRef={ruleDirtyRef}
            />
          )}
        </>
      }
    >
      <div className="flex flex-col h-full">
        <PortForwardingToolbar
          search={search}
          onSearchChange={setSearch}
          layoutMode={layoutMode as LayoutMode}
          onLayoutModeChange={setLayoutMode}
          sortMode={sortMode as SortMode}
          onSortModeChange={setSortMode}
          onNewRule={openNew}
          // default name kept in English until all creation sites are localized together (see i18n issue #14)
          onNewFolder={() => void saveFolder({ name: "New Folder", object_type: "port_forwarding", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }).then((f) => { closeForm(); setEditingFolderId(f.id); })}
          selectedCount={[...selectedIdSet].filter((id) => filteredRuleIdSet.has(id)).length}
          onDeleteSelected={[...selectedIdSet].some((id) => filteredRuleIdSet.has(id)) ? () => setConfirmDeleteIds([...selectedIdSet].filter((id) => filteredRuleIdSet.has(id))) : undefined}
        />

        <DragSelectSurface
          selectionAreaRef={selectionAreaRef}
          onMouseDown={handleSelectionAreaMouseDown}
          dragBox={dragBox}
          className="flex-1 overflow-y-auto px-9 pt-5 pb-9"
          onClick={() => {
            if (!showForm && !editingFolder) return;
            closeForm();
            setEditingFolderId(null);
          }}
          onContextMenu={(e) => {
            if ((e.target as Element).closest("[data-card],[data-folder-card]")) return;
            setSelection([]);
            openBgMenu(e);
          }}
        >
          <ActiveTunnelsSection />

          <div ref={itemAreaRef} data-drag-surface="true" className="space-y-6 mt-4">

            {/* ── Folder breadcrumb ── */}
            {folderPath.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  className="flex items-center gap-1.5 text-xs transition-colors text-(--t-text-dim) hover:text-(--t-text-primary)"
                  onClick={navigateToRoot}
                >
                  <Icon icon="lucide:chevron-left" width={13} />
                  {t("portForwarding.page.all")}
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
                      <span className="text-xs font-medium text-(--t-text-primary)">{folder.name}</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* ── Folders section ── */}
            {visibleFolders.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">{t("portForwarding.page.folders")}</p>
                  <button
                    className="flex items-center gap-1 text-xs transition-colors px-2 py-1 rounded-lg text-(--t-text-dim)"
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-primary)"; e.currentTarget.style.background = "var(--t-bg-elevated)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-dim)"; e.currentTarget.style.background = "transparent"; }}
                    // default name kept in English until all creation sites are localized together (see i18n issue #14)
                    onClick={() => void saveFolder({ name: "New Folder", object_type: "port_forwarding", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }).then((f) => { closeForm(); setEditingFolderId(f.id); })}
                  >
                    <Icon icon="lucide:plus" width={12} />
                    {t("portForwarding.page.new")}
                  </button>
                </div>
                <div
                  className={layoutMode === "grid" ? "grid gap-4" : "flex flex-col gap-1"}
                  style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" } : undefined}
                >
                  {visibleFolders.map((folder) => {
                    const folderCanEdit = canEdit(folder.vault_id ?? "personal");
                    return (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        itemCount={folderCounts[folder.id] ?? 0}
                        layout={layoutMode as "grid" | "list"}
                        isSelected={editingFolderId === folder.id || selectedIdSet.has(folder.id)}
                        isFocused={focusedId === folder.id}
                        isDragOver={dragOverFolderId === folder.id}
                        onClick={() => navigateInto(folder)}
                        onRename={(f, newName) => void updateFolder(f.id, { name: newName, object_type: f.object_type, parent_folder_id: f.parent_folder_id, vault_id: f.vault_id })}
                        onDelete={(f) => setConfirmDeleteFolderId(f.id)}
                        onSelect={(id) => { if (!selectedIdSet.has(id)) selectSingle(id); }}
                        onEdit={() => { closeForm(); setEditingFolderId(folder.id); }}
                        onPointerDown={(e) => handleFolderDragStart(e, folder.id)}
                        {...(folderCanEdit ? folderDropProps(folder.id) : {})}
                        vaults={vaultOptions.filter((v) => v.id !== (folder.vault_id ?? "personal"))}
                        canEdit={folderCanEdit}
                        onMoveToVault={(vaultId) => handleMoveFolderToVault(folder, vaultId)}
                        onCopyToVault={(vaultId) => handleCopyFolderToVault(folder, vaultId)}
                        onExport={() => useUIStore.getState().openImportExport("export", { bulk: { portForwardingRules: rules.filter((r) => r.folder_id === folder.id).map((r) => r.id) } })}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Eject drop zone ── */}
            {activeFolderId && (
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-150"
                style={{
                  border: dragOverEject ? "2px solid var(--t-accent)" : "2px dashed var(--t-border-hover)",
                  background: dragOverEject ? "color-mix(in srgb, var(--t-accent) 8%, var(--t-bg-card))" : "transparent",
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
                  {ejectTargetFolderId ? t("portForwarding.page.ejectMoveTo", { name: folderPath[folderPath.length - 2].name }) : t("portForwarding.page.ejectRemoveFromFolder")}
                </span>
              </div>
            )}

            {/* ── Rules section ── */}
            {filtered.length === 0 && visibleFolders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-(--t-text-dim)">
                <span className="text-sm">
                  {q ? t("portForwarding.page.noRulesMatchSearch") : activeFolderId ? t("portForwarding.page.folderEmpty") : t("portForwarding.page.noRulesYet")}
                </span>
                {activeFolderId && !q && (
                  <button
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-(--t-bg-elevated) text-(--t-accent) border border-(--t-border-hover)"
                    onClick={openNew}
                  >
                    <Icon icon="lucide:plus" width={12} />
                    {t("portForwarding.page.addRule")}
                  </button>
                )}
              </div>
            ) : filtered.length > 0 && (
              <div>
                {(visibleFolders.length > 0 || activeFolderId || filtered.length > 0) && (
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">{t("common.entity.rules")}</p>
                    <div className="flex items-center gap-2 text-[10px] text-(--t-text-muted)">
                      <span className="px-1.5 py-0.5 rounded-full bg-(--t-bg-elevated)">{t("portForwarding.page.total", { count: filtered.length })}</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400">{t("portForwarding.page.activeCount", { count: runningRuleCount.active })}</span>
                      {runningRuleCount.error > 0 && <span className="px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400">{t("portForwarding.page.errorCount", { count: runningRuleCount.error })}</span>}
                    </div>
                  </div>
                )}
                <div
                  className={layoutMode === "grid"
                    ? "grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4"
                    : "flex flex-col gap-1"
                  }
                >
                  {filtered.map((rule) => {
                    const { status, isActive, statusLabel, isBusy, webUrl } = statusFor(rule);
                    return (
                      <RuleCard
                        key={rule.id}
                        rule={rule}
                        layout={layoutMode as LayoutMode}
                        isSelected={selectedIdSet.has(rule.id)}
                        isFocused={focusedId === rule.id}
                        isActive={isActive}
                        status={status}
                        statusLabel={statusLabel}
                        isBusy={isBusy}
                        webUrl={webUrl}
                        canEdit={canEdit(rule.vault_id)}
                        vaults={vaultOptions.filter((v) => v.id !== (rule.vault_id ?? "personal"))}
                        onSelect={(id, e) => handleItemSelect(id, e)}
                        onEdit={openEdit}
                        onDuplicate={(id) => void duplicateRule(id)}
                        onDelete={handleDeleteRule}
                        onStart={(r) => void startRule(r)}
                        onStop={(r) => void stopRule(r)}
                        onOpenWeb={(url) => void openUrl(url)}
                        onMoveToVault={(r, vaultId) => handleMoveRuleToVault(r, vaultId)}
                        onCopyToVault={(r, vaultId) => handleCopyRuleToVault(r, vaultId)}
                        bulkContextMenuItems={bulkContextMenuItems}
                        onPointerDown={(e) => handleDragStart(e, rule.id)}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </DragSelectSurface>
      </div>

      {bgMenuPos && (
        <ContextMenu
          pos={bgMenuPos}
          onClose={closeBgMenu}
          items={[
            { label: t("portForwarding.page.contextMenu.newRule"), icon: "lucide:network", onClick: openNew },
            // default name kept in English until all creation sites are localized together (see i18n issue #14)
            { label: "New Folder", icon: "lucide:folder-plus", onClick: () => void saveFolder({ name: "New Folder", object_type: "port_forwarding", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }).then((f) => { closeForm(); setEditingFolderId(f.id); }) },
          ]}
        />
      )}
    </SidePanelLayout>

    {confirmDeleteId && (
      <ConfirmModal
        title={t("portForwarding.page.confirmDelete.title")}
        message={t("portForwarding.page.confirmDelete.message")}
        confirmLabel={t("common.action.delete")}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    )}

    {confirmDeleteIds && (
      <ConfirmModal
        title={t("portForwarding.page.confirmDeleteBulk.title", { count: confirmDeleteIds.length })}
        message={t("portForwarding.page.confirmDeleteBulk.message", { count: confirmDeleteIds.length })}
        confirmLabel={t("common.action.delete")}
        onConfirm={async () => {
          for (const id of confirmDeleteIds) await deleteRule(id);
          setConfirmDeleteIds(null);
          setSelection([]);
        }}
        onCancel={() => setConfirmDeleteIds(null)}
      />
    )}

    {confirmDeleteFolderId && (
      <ConfirmModal
        title={t("portForwarding.page.confirmDeleteFolder.title")}
        message={t("portForwarding.page.confirmDeleteFolder.message")}
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
