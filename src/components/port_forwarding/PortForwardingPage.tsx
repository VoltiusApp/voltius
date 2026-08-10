import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "@iconify/react";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useAllPortForwardingRules } from "@/hooks/useAllPortForwardingRules";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useUIStore } from "@/stores/uiStore";
import { usePermissions } from "@/hooks/usePermission";
import { useAccessibleVaultIds, useScopedVaultId } from "@/hooks/useAccessibleVaultIds";
import { useDefaultVaultId } from "@/hooks/useWritableVaultIds";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { usePageBulkActions } from "@/hooks/usePageBulkActions";
import { useDragToFolder } from "@/hooks/useDragToFolder";
import { folderDragHandlers } from "@/utils/folderDragHandlers";
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
import { usePageClipboard } from "@/hooks/usePageClipboard";
import { vaultClipboardBase } from "@/utils/vaultClipboardBase";
import { nameIsFree } from "@/utils/cloneName";
import { useCrossVaultPasteConfirm } from "@/hooks/useCrossVaultPasteConfirm";
import { ClipboardPill } from "@/components/shared/ClipboardPill";
import { useVaultClipboardStore, type VaultClipboardKind } from "@/stores/vaultClipboardStore";
import { getShortcutHint } from "@/stores/shortcutStore";
import { clipboardMenuItems } from "@/utils/clipboardMenuItems";
import { PortForwardingToolbar } from "./PortForwardingToolbar";
import { ActiveTunnelsSection } from "./ActiveTunnelsSection";
import { RuleCard } from "./RuleCard";
import { RuleForm } from "./RuleForm";
import type { Folder, PortForwardingRule, PortForwardingRuleFormData } from "@/types";
import type { LayoutMode, SortMode } from "@/components/shared/ToolbarViewControls";
import { descendantFolders, itemsInFolderSubtree } from "@/utils/folderTree";
import { folderDeleteMessages } from "@/utils/folderDeleteMessages";
import { useVaultOptions } from "@/hooks/useVaultOptions";
import { useScopedFolders } from "@/hooks/useScopedFolders";
import { FolderBreadcrumb } from "@/components/folders/FolderBreadcrumb";
import { FolderEjectZone } from "@/components/folders/FolderEjectZone";
import { cloneFolderTree, copyFolderSubtree } from "@/utils/folderCopy";
import { moveFolderTreeToVault } from "@/utils/folderMove";

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

function ruleToForm(
  rule: PortForwardingRule,
  over: Partial<PortForwardingRuleFormData> = {},
): PortForwardingRuleFormData {
  return {
    name: rule.name,
    local_port: rule.local_port,
    remote_port: rule.remote_port,
    remote_host: rule.remote_host,
    tunnel_type: rule.tunnel_type ?? "local",
    bind_host: rule.bind_host ?? "127.0.0.1",
    target_host: rule.target_host ?? "127.0.0.1",
    description: rule.description,
    connection_ids: [...rule.connection_ids],
    folder_id: rule.folder_id,
    vault_id: rule.vault_id,
    ...over,
  };
}

export function PortForwardingPage() {
  const { t } = useTranslation();
  const { loadRules, createRule, updateRule, deleteRule, duplicateRule, moveRuleFolder } =
    usePortForwardingStore();
  const rules = useAllPortForwardingRules();
  const connections = useAllConnections();
  const { runningRuleCount, statusFor, startRule, stopRule } = useRuleTunnels();
  const { loadFolders, saveFolder, updateFolder, deleteFolder, moveFolder } = useFolderStore();
  const folders = useAllFolders();
  const { pending: cascadePending, request: requestCascade, confirm: confirmCascade, cancel: cancelCascade } = useVaultCascade();
  const crossVaultPaste = useCrossVaultPasteConfirm();

  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const layoutMode = useUIStore((s) => s.portForwardingLayoutMode);
  const setLayoutMode = useUIStore((s) => s.setPortForwardingLayoutMode);
  const sortMode = useUIStore((s) => s.portForwardingSortMode);
  const setSortMode = useUIStore((s) => s.setPortForwardingSortMode);
  const pendingAction = useUIStore((s) => s.portForwardingPendingAction);
  const setPendingAction = useUIStore((s) => s.setPortForwardingPendingAction);

  const accessibleVaultIds = useAccessibleVaultIds();
  const scopedVaultId = useScopedVaultId();
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

  const vaultOptions = useVaultOptions({ includeUnlinkedTeams: false });

  const scopedFolders = useScopedFolders(folders, accessibleVaultIds, "port_forwarding");
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
    void updateRule(rule.id, ruleToForm(rule, { vault_id: vaultId }));
  };

  const handleCopyRuleToVault = (rule: PortForwardingRule, vaultId: string) => {
    const destHasName = rules.some((r) => (r.vault_id ?? "personal") === vaultId && r.name === rule.name);
    void createRule(ruleToForm(rule, {
      name: destHasName ? `${rule.name} (copy)` : rule.name,
      vault_id: vaultId,
    }));
  };

  // ── Vault move / copy for folders ─────────────────────────────────────────

  /** All folders in the subtree rooted at folderId (BFS-ordered, parents before children). */
  const getAllSubFolders = (folderId: string): Folder[] => descendantFolders(scopedFolders, folderId);

  const getRulesInFolderTree = (folderId: string): PortForwardingRule[] =>
    itemsInFolderSubtree(rules, scopedFolders, folderId);

  const { folderDeleteMessage } = folderDeleteMessages({
    t,
    prefix: "portForwarding.page",
    folders: scopedFolders,
    itemIdsInFolderTree: (id) => getRulesInFolderTree(id).map((r) => r.id),
  });

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
        await moveFolderTreeToVault({ root: folder, subFolders, parentFolderId: folder.parent_folder_id ?? null, vaultId, updateFolder });
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
        const folderIdMap = await copyFolderSubtree({
          root: folder, subFolders, vaultId, existingFolders: folders, saveFolder,
        });
        const newRootId = folderIdMap.get(folder.id)!;
        for (const r of treeRules) {
          const newFolderId = r.folder_id ? (folderIdMap.get(r.folder_id) ?? newRootId) : newRootId;
          const destHasRule = rules.some((x) => (x.vault_id ?? "personal") === vaultId && x.name === r.name);
          await createRule({ name: destHasRule ? `${r.name} (copy)` : r.name, local_port: r.local_port, remote_port: r.remote_port, remote_host: r.remote_host, tunnel_type: r.tunnel_type ?? "local", bind_host: r.bind_host ?? "127.0.0.1", target_host: r.target_host ?? "127.0.0.1", description: r.description, connection_ids: r.connection_ids, folder_id: newFolderId, vault_id: vaultId });
        }
      },
    });
  };

  // ── Clipboard paste helpers ───────────────────────────────────────────────

  /**
   * Duplicates `rule` into `folderId`, optionally into another vault. `keepName` is
   * for members of a subtree being cloned wholesale — only the root of such a clone
   * carries the "(copy)" suffix.
   */
  const duplicateRuleInto = async (
    rule: PortForwardingRule,
    folderId: string | null,
    opts: { vaultId?: string; keepName?: boolean } = {},
  ) => createRule(ruleToForm(rule, {
    // default name suffix kept in English until all creation sites are localized together (see i18n issue #14)
    name: opts.keepName ? rule.name : `${rule.name} (copy)`,
    folder_id: folderId ?? undefined,
    vault_id: opts.vaultId ?? rule.vault_id,
  }));

  /** Deep-clones a folder subtree under `parentFolderId`, into `vaultId` when given. */
  const copyFolderInto = async (
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
    for (const rule of getRulesInFolderTree(folder.id)) {
      await duplicateRuleInto(rule, folderIdMap.get(rule.folder_id ?? "") ?? root.id, {
        vaultId: targetVaultId,
        keepName: true,
      });
    }
    return root;
  };

  /** Moves a folder subtree into `vaultId`, reparenting the root at the same time. */
  const migrateFolderTreeToVault = async (
    folder: Folder,
    parentFolderId: string | null,
    vaultId: string,
  ) => {
    await moveFolderTreeToVault({ root: folder, subFolders: getAllSubFolders(folder.id), parentFolderId, vaultId, updateFolder });
    for (const rule of getRulesInFolderTree(folder.id)) {
      await updateRule(rule.id, ruleToForm(rule, { vault_id: vaultId }));
    }
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

  // ── Cut / copy / paste ────────────────────────────────────────────────────

  const clipboard = useVaultClipboardStore((s) => s.clipboard);
  const cutIds = useMemo(
    () =>
      new Set(
        clipboard?.tab === "port-forwarding" && clipboard.mode === "cut"
          ? [...clipboard.items.map((i) => i.id), ...clipboard.folderIds]
          : [],
      ),
    [clipboard],
  );

  const { vaultForFolder, adapter: clipboardBase } = vaultClipboardBase({
    navItem: "port-forwarding",
    entities: [{ kind: "port_forward", items: rules }],
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
    migrateFolderTreeToVault,
    moveFolder,
    copyFolderInto,
    deleteFolder,
  });

  // Every mutation below goes through a store method so vault permission checks apply.
  // Rules own no secrets, so nothing has to be republished on a cross-vault write.
  usePageClipboard({
    ...clipboardBase,
    folderContentKinds: (folderId): VaultClipboardKind[] =>
      getRulesInFolderTree(folderId).length > 0 ? ["port_forward"] : [],
    // A migrated rule keeps pointing at the hosts it tunnels through, which this
    // path does not move. Unlike Hosts and Keychain this cannot be expressed as a
    // missing permission — a rule and a connection share EDIT_CONNECTIONS, so
    // anyone allowed to paste the rule is already allowed the connection.
    danglingKinds: (items, folderIds, destination): VaultClipboardKind[] => {
      const moved = [
        ...items.map((i) => rules.find((r) => r.id === i.id)).filter((r) => !!r),
        ...folderIds.flatMap((id) => getRulesInFolderTree(id)),
      ];
      const linked = moved
        .flatMap((r) => r.connection_ids)
        .map((id) => connections.find((c) => c.id === id))
        .filter((c) => !!c);
      return linked.some((c) => (c.vault_id ?? "personal") !== destination) ? ["connection"] : [];
    },
    // A same-vault move only rewrites folder_id; a cross-vault one has to go through
    // updateRule so the object actually changes vault, otherwise it would keep a
    // stale vault_id alongside its new folder's.
    moveItems: async (ids, folderId, vaultId) => {
      for (const id of ids) {
        const rule = rules.find((r) => r.id === id);
        if (!rule) continue;
        if (vaultId === null || (rule.vault_id ?? "personal") === vaultId) {
          await moveRuleFolder(id, folderId);
          continue;
        }
        await updateRule(id, ruleToForm(rule, { folder_id: folderId ?? undefined, vault_id: vaultId }));
      }
    },
    duplicateItems: async (ids, folderId) => {
      const targetVault = vaultForFolder(folderId) ?? undefined;
      const created: string[] = [];
      for (const id of ids) {
        const rule = rules.find((r) => r.id === id);
        if (!rule) continue;
        created.push((await duplicateRuleInto(rule, folderId, {
          vaultId: targetVault,
          keepName: nameIsFree(rules, rule.name, targetVault ?? rule.vault_id ?? "personal", folderId),
        })).id);
      }
      return created;
    },
    deleteItems: async (ids) => { for (const id of ids) await deleteRule(id); },
  });

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
    ...folderDragHandlers({
      moveItems: async (ids, folderId) => {
        for (const id of ids) await moveRuleFolder(id, folderId);
        await loadRules();
      },
      moveFolders: async (folderDragIds, targetParentId) => {
        for (const id of folderDragIds) await moveFolder(id, targetParentId);
        await loadFolders();
      },
    }),
  });

  // ── Selection-aware delete & bulk context menu ────────────────────────────

  const selectedRules = useMemo(
    () => filtered.filter((r) => selectedIdSet.has(r.id)),
    [filtered, selectedIdSet],
  );
  const selectedFolders = useMemo(
    () => visibleFolders.filter((f) => selectedIdSet.has(f.id)),
    [visibleFolders, selectedIdSet],
  );

  const handleDeleteRule = useCallback((id: string) => {
    if (selectedIdSet.has(id) && selectedRules.length > 1) {
      setConfirmDeleteIds(selectedRules.map((r) => r.id));
    } else {
      setConfirmDeleteId(id);
    }
  }, [selectedIdSet, selectedRules]);

  const bulkContextMenuItems = useMemo<ContextMenuItem[] | undefined>(() => {
    const n = selectedRules.length;
    // Folders count too: a folder-only selection still needs cut/copy.
    if (n + selectedFolders.length < 2) return undefined;
    const allCanEdit = selectedRules.every((r) => canEdit(r.vault_id ?? "personal"));
    const sharedVaults = vaultOptions.filter((v) =>
      selectedRules.some((r) => (r.vault_id ?? "personal") !== v.id),
    );
    return [
      ...(n > 0 && allCanEdit ? [{
        label: t("portForwarding.page.bulk.duplicateRules", { count: n }),
        icon: "lucide:copy",
        onClick: () => { void Promise.all(selectedRules.map((r) => duplicateRule(r.id))); },
      }] : []),
      ...vaultMenuItems(
        allCanEdit ? sharedVaults : undefined,
        allCanEdit,
        sharedVaults.length > 0 ? (vaultId) => { for (const r of selectedRules) handleMoveRuleToVault(r, vaultId); } : undefined,
        sharedVaults.length > 0 ? (vaultId) => { for (const r of selectedRules) handleCopyRuleToVault(r, vaultId); } : undefined,
        t,
      ),
      ...(n > 0 ? [{
        label: t("portForwarding.page.bulk.exportRules", { count: n }),
        icon: "lucide:upload",
        onClick: () => useUIStore.getState().openImportExport("export", { bulk: { portForwardingRules: selectedRules.map((r) => r.id) } }),
      }] : []),
      ...clipboardMenuItems(t),
      ...(n > 0 ? [{
        label: t("portForwarding.page.bulk.deleteRules", { count: n }),
        icon: "lucide:trash-2",
        onClick: () => setConfirmDeleteIds(selectedRules.map((r) => r.id)),
        danger: true,
        divider: true,
      }] : []),
    ];
  }, [selectedRules, selectedFolders, canEdit, vaultOptions, duplicateRule, handleMoveRuleToVault, handleCopyRuleToVault, t]);

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
          onNewFolder={() => void saveFolder({ name: "New Folder" /* persisted English default; menu label is localized */, object_type: "port_forwarding", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }).then((f) => { closeForm(); setEditingFolderId(f.id); })}
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
            <FolderBreadcrumb
              path={folderPath}
              rootLabel={t("portForwarding.page.all")}
              onNavigateToRoot={navigateToRoot}
              onNavigateTo={navigateTo}
            />

            {/* ── Folders section ── */}
            {visibleFolders.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">{t("portForwarding.page.folders")}</p>
                  <button
                    className="flex items-center gap-1 text-xs transition-colors px-2 py-1 rounded-lg text-(--t-text-dim)"
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-primary)"; e.currentTarget.style.background = "var(--t-bg-elevated)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-dim)"; e.currentTarget.style.background = "transparent"; }}
                    onClick={() => void saveFolder({ name: "New Folder" /* persisted English default */, object_type: "port_forwarding", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }).then((f) => { closeForm(); setEditingFolderId(f.id); })}
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
                        dimmed={cutIds.has(folder.id)}
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
                        bulkContextMenuItems={selectedIdSet.size > 1 ? bulkContextMenuItems : undefined}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Eject drop zone ── */}
            {activeFolderId && (
              <FolderEjectZone
                label={ejectTargetFolderId
                  ? t("portForwarding.page.ejectMoveTo", { name: folderPath[folderPath.length - 2].name })
                  : t("portForwarding.page.ejectRemoveFromFolder")}
                isDragging={isDragging}
                dragOver={dragOverEject}
                dropProps={ejectDropProps(ejectTargetFolderId)}
              />
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
                        dimmed={cutIds.has(rule.id)}
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
            { label: t("portForwarding.toolbar.newFolder"), icon: "lucide:folder-plus", onClick: () => void saveFolder({ name: "New Folder" /* persisted English default */, object_type: "port_forwarding", parent_folder_id: activeFolderId ?? undefined, vault_id: defaultVaultId }).then((f) => { closeForm(); setEditingFolderId(f.id); }) },
            ...(useVaultClipboardStore.getState().clipboard?.tab === "port-forwarding"
              ? [{ label: t("common.action.paste"), icon: "lucide:clipboard", shortcut: getShortcutHint("paste"), onClick: () => window.dispatchEvent(new CustomEvent("voltius:clipboard-paste")) } as const]
              : []),
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

    <ClipboardPill navItem="port-forwarding" />

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
    </>
  );
}
