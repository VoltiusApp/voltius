import { useEffect, useMemo, useState } from "react";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useUIStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { usePermissions } from "@/hooks/usePermission";
import { useAccessibleVaultIds } from "@/hooks/useAccessibleVaultIds";
import { useDragSelection } from "@/hooks/useDragSelection";
import { useListKeyNav } from "@/hooks/useListKeyNav";
import { SidePanelLayout } from "@/components/shared/SidePanelLayout";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { PortForwardingToolbar } from "./PortForwardingToolbar";
import { ActiveTunnelsSection } from "./ActiveTunnelsSection";
import { RuleCard } from "./RuleCard";
import { RuleForm } from "./RuleForm";
import type { PortForwardingRule, PortForwardingRuleFormData, VaultOption } from "@/types";
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
  const { rules, loadRules, createRule, updateRule, deleteRule, duplicateRule } =
    usePortForwardingStore();

  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const layoutMode = useUIStore((s) => s.portForwardingLayoutMode);
  const setLayoutMode = useUIStore((s) => s.setPortForwardingLayoutMode);
  const sortMode = useUIStore((s) => s.portForwardingSortMode);
  const setSortMode = useUIStore((s) => s.setPortForwardingSortMode);
  const pendingAction = useUIStore((s) => s.portForwardingPendingAction);
  const setPendingAction = useUIStore((s) => s.setPortForwardingPendingAction);

  const vaults = useVaultStore((s) => s.vaults);
  const accessibleVaultIds = useAccessibleVaultIds();
  const can = usePermissions();

  const [search, setSearch] = useState("");
  const [editingRule, setEditingRule] = useState<PortForwardingRule | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    loadRules();
  }, []);

  useEffect(() => {
    if (pendingAction?.action === "create") {
      setEditingRule(null);
      setShowForm(true);
      setPendingAction(null);
    } else if (pendingAction?.action === "edit") {
      const rule = rules.find((r) => r.id === pendingAction.id) ?? null;
      setEditingRule(rule);
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

  const q = useMemo(() => search.trim().toLowerCase(), [search]);

  const filtered = useMemo(() => {
    const accessible = rules.filter((r) => accessibleVaultIds.includes(r.vault_id));
    const searched = q
      ? accessible.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.description?.toLowerCase().includes(q) ||
            String(r.local_port).includes(q) ||
            String(r.remote_port).includes(q),
        )
      : accessible;
    return sortRules(searched, sortMode as SortMode);
  }, [rules, accessibleVaultIds, q, sortMode]);

  function openNew() {
    setEditingRule(null);
    setShowForm(true);
  }

  function openEdit(rule: PortForwardingRule) {
    setEditingRule(rule);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingRule(null);
  }

  async function handleSave(data: PortForwardingRuleFormData) {
    if (editingRule) {
      await updateRule(editingRule.id, data);
    } else {
      await createRule(data);
    }
    closeForm();
  }

  async function handleDelete(id: string) {
    setConfirmDeleteId(id);
  }

  async function confirmDelete() {
    if (confirmDeleteId) {
      await deleteRule(confirmDeleteId);
      setConfirmDeleteId(null);
    }
  }

  async function handleDuplicate(id: string) {
    await duplicateRule(id);
  }

  const orderedIds = useMemo(() => filtered.map((r) => r.id), [filtered]);

  const { selectedIdSet, itemAreaRef, selectSingle, setSelection } = useDragSelection(orderedIds);

  const { focusedId } = useListKeyNav({
    orderedIds,
    selectedIdSet,
    selectSingle,
    setSelection,
    itemAreaRef,
    layoutMode: layoutMode as "grid" | "list",
    onEnter: (id) => { const r = filtered.find((r) => r.id === id); if (r) openEdit(r); },
    onEdit:  (id) => { const r = filtered.find((r) => r.id === id); if (r) openEdit(r); },
    onDuplicate: (id) => { void handleDuplicate(id); },
    onEscape: () => { if (showForm) closeForm(); else setSelection([]); },
    onSearch: () => setOmniOpen(true),
  });

  const canEditForVault = (vaultId: string) => can("EDIT_CONNECTIONS", vaultId);

  const mainContent = (
    <div className="flex flex-col h-full">
      <PortForwardingToolbar
        search={search}
        onSearchChange={setSearch}
        layoutMode={layoutMode as LayoutMode}
        onLayoutModeChange={setLayoutMode}
        sortMode={sortMode as SortMode}
        onSortModeChange={setSortMode}
        onNewRule={openNew}
      />

      <div className="flex-1 overflow-y-auto pt-4">
        <ActiveTunnelsSection />

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--t-text-dim)] px-4">
            <span className="text-sm">
              {q ? "No rules match your search." : "No rules yet. Create one to get started."}
            </span>
          </div>
        ) : (
          <div
            ref={itemAreaRef}
            className={layoutMode === "grid"
              ? "grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3 px-4 pb-4"
              : "flex flex-col gap-1 px-4 pb-4"
            }
          >
            {filtered.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                layout={layoutMode as LayoutMode}
                isSelected={selectedIdSet.has(rule.id)}
                isFocused={focusedId === rule.id}
                canEdit={canEditForVault(rule.vault_id)}
                vaults={vaultOptions.filter((v) => v.id !== rule.vault_id)}
                onSelect={(id) => selectSingle(id)}
                onEdit={openEdit}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <SidePanelLayout
        panelOpen={showForm}
        panelWidth={340}
        panel={
          showForm ? (
            <RuleForm rule={editingRule} onSave={handleSave} onClose={closeForm} />
          ) : null
        }
      >
        {mainContent}
      </SidePanelLayout>

      {confirmDeleteId && (
        <ConfirmModal
          title="Delete rule"
          message="This rule will be permanently deleted."
          confirmLabel="Delete"
          onConfirm={confirmDelete}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </>
  );
}
