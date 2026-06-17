import { useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useAllPortForwardingRules } from "@/hooks/useAllPortForwardingRules";
import { useAllFolders } from "@/hooks/useAllFolders";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { useRuleTunnels } from "@/hooks/useRuleTunnels";
import { useFolderStore } from "@/stores/folderStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useVaultStore } from "@/stores/vaultStore";
import { AvatarTile } from "@/components/shared/AvatarTile";
import MobileFilterBar from "@/components/mobile/MobileFilterBar";
import MobilePanelHeader from "@/components/mobile/panels/MobilePanelHeader";
import RuleActionsSheet from "@/components/mobile/sheets/RuleActionsSheet";
import AddChoiceSheet from "@/components/mobile/sheets/AddChoiceSheet";
import FolderFormSheet from "@/components/mobile/sheets/FolderFormSheet";
import FolderActionsSheet from "@/components/mobile/sheets/FolderActionsSheet";
import MobileFolderBreadcrumb from "@/components/mobile/folders/MobileFolderBreadcrumb";
import MobileFolderRow from "@/components/mobile/folders/MobileFolderRow";
import FolderBackTrap from "@/components/mobile/folders/FolderBackTrap";
import { RuleForm } from "@/components/port_forwarding/RuleForm";
import { scopeItems, folderItemCount } from "@/components/mobile/folders/mobileFolderCore";
import type { PortForwardingRule, Folder } from "@/types";

type FormRule = PortForwardingRule | null | "new" | undefined;
type AddMode = null | "menu" | "new-folder";

export default function MobilePortForwardingScreen() {
  const allRules = useAllPortForwardingRules();
  const allFolders = useAllFolders();
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const { runningRuleCount, statusFor, startRule, stopRule } = useRuleTunnels();
  const createRule = usePortForwardingStore((s) => s.createRule);
  const updateRule = usePortForwardingStore((s) => s.updateRule);
  const saveFolder = useFolderStore((s) => s.saveFolder);
  const updateFolder = useFolderStore((s) => s.updateFolder);
  const deleteFolder = useFolderStore((s) => s.deleteFolder);

  const [search, setSearch] = useState("");
  const [sheetRule, setSheetRule] = useState<PortForwardingRule | null>(null);
  const [formRule, setFormRule] = useState<FormRule>(undefined);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [folderSheet, setFolderSheet] = useState<Folder | null>(null);
  const dirtyRef = useRef<boolean>(false);

  const pfFolders = useMemo(
    () => allFolders.filter((f) => f.object_type === "port_forwarding" && selectedVaultIds.includes(f.vault_id ?? "personal")),
    [allFolders, selectedVaultIds],
  );
  const nav = useFolderNavigation(pfFolders);
  const subfolders = useMemo(() => [...nav.visibleFolders].sort((a, b) => a.name.localeCompare(b.name)), [nav.visibleFolders]);

  const rules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopeItems(allRules, nav.activeFolderId)
      .filter((r) => !q || r.name.toLowerCase().includes(q) || String(r.local_port).includes(q) || String(r.remote_port).includes(q) || r.remote_host.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allRules, nav.activeFolderId, search]);

  const closeForm = () => { setFormRule(undefined); dirtyRef.current = false; };
  const targetVaultId = nav.folderPath[nav.folderPath.length - 1]?.vault_id ?? selectedVaultIds[0] ?? "personal";
  const createFolder = (name: string) =>
    void saveFolder({ name, object_type: "port_forwarding", parent_folder_id: nav.activeFolderId ?? undefined, vault_id: targetVaultId });

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      {nav.folderPath.map((f) => <FolderBackTrap key={f.id} onBack={() => nav.setFolderPath((p) => p.slice(0, -1))} />)}
      <MobilePanelHeader
        title="Port Forwarding"
        right={
          <button data-pf-add onClick={() => setAddMode("menu")} className="p-2 text-(--t-text-primary)">
            <Icon icon="lucide:plus" width={22} />
          </button>
        }
      />
      <MobileFilterBar value={search} onChange={setSearch} placeholder="Filter rules…" />
      <MobileFolderBreadcrumb path={nav.folderPath} onNavigate={(i) => (i < 0 ? nav.navigateToRoot() : nav.navigateTo(i))} />
      <div className="px-4 py-1 text-xs text-(--t-text-dim)">{allRules.length} total &middot; {runningRuleCount.active} active</div>

      <div className="flex-1 overflow-y-auto pb-4">
        {!search && subfolders.map((f) => (
          <MobileFolderRow key={f.id} name={f.name} count={folderItemCount(allRules, f.id)} onOpen={() => nav.navigateInto(f)} onActions={() => setFolderSheet(f)} />
        ))}

        {rules.map((rule) => {
          const st = statusFor(rule);
          return (
            <div key={rule.id} data-pf-rule className="w-full flex items-center gap-3 px-4 py-2.5">
              <AvatarTile icon="lucide:arrow-left-right" className="w-9 h-9 rounded-lg" iconSize={18} />
              <button className="flex-1 min-w-0 text-left" onClick={() => setSheetRule(rule)}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-(--t-text-primary) truncate">{rule.name}</span>
                  <span className="shrink-0 rounded-sm px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-(--t-text-dim)" style={{ background: "var(--t-bg-card)" }}>{rule.tunnel_type}</span>
                </div>
                <div className="text-[11px] text-(--t-text-dim) truncate">{st.statusLabel}</div>
                <div className="text-[11px] font-mono text-(--t-text-dim) truncate">{rule.local_port} &rarr; {rule.remote_host}:{rule.remote_port}</div>
              </button>
              <button data-pf-toggle className="shrink-0 p-2 text-(--t-text-primary)" onClick={(e) => { e.stopPropagation(); if (st.status === "active") void stopRule(rule); else void startRule(rule); }}>
                <Icon icon={st.isBusy ? "lucide:loader-circle" : st.status === "active" ? "lucide:pause" : "lucide:play"} width={18} className={st.isBusy ? "animate-spin" : undefined} />
              </button>
            </div>
          );
        })}

        {subfolders.length === 0 && rules.length === 0 && (
          <div className="flex flex-col items-center justify-center px-8 py-16 text-center text-(--t-text-dim)">
            <Icon icon="lucide:arrow-left-right" width={28} className="mb-2 opacity-60" />
            <p className="text-sm">{search.trim() ? "No rules match your search" : "No port-forwarding rules yet"}</p>
          </div>
        )}
      </div>

      {formRule !== undefined && formRule !== null && (
        <div className="absolute inset-0 z-40 flex flex-col bg-(--t-bg-base)">
          <div className="flex-1 overflow-y-auto">
            <RuleForm
              rule={formRule === "new" ? null : formRule}
              isDirtyRef={dirtyRef}
              onClose={closeForm}
              onSave={async (data) => { if (formRule === "new") await createRule(data); else await updateRule(formRule.id, data); closeForm(); }}
            />
          </div>
        </div>
      )}

      {addMode === "menu" && (
        <AddChoiceSheet
          newItemLabel="New rule"
          newItemIcon="lucide:arrow-left-right"
          onNewItem={() => { setAddMode(null); setFormRule("new"); }}
          onNewFolder={() => setAddMode("new-folder")}
          onClose={() => setAddMode(null)}
        />
      )}
      {addMode === "new-folder" && (
        <FolderFormSheet title="New folder" submitLabel="Create" onSubmit={createFolder} onClose={() => setAddMode(null)} />
      )}
      {folderSheet && (
        <FolderActionsSheet
          folder={folderSheet}
          onRename={(name) => void updateFolder(folderSheet.id, { name, object_type: "port_forwarding", parent_folder_id: folderSheet.parent_folder_id, vault_id: folderSheet.vault_id })}
          onDelete={() => { nav.onFolderDeleted(folderSheet.id); void deleteFolder(folderSheet.id); }}
          onClose={() => setFolderSheet(null)}
        />
      )}
      {sheetRule && (
        <RuleActionsSheet rule={sheetRule} onEdit={(r) => { setSheetRule(null); setFormRule(r); }} onClose={() => setSheetRule(null)} />
      )}
    </div>
  );
}
