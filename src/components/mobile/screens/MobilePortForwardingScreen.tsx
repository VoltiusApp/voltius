import { useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useAllPortForwardingRules } from "@/hooks/useAllPortForwardingRules";
import { useAllFolders } from "@/hooks/useAllFolders";
import { useRuleTunnels } from "@/hooks/useRuleTunnels";
import { useCloseWhenGone } from "@/hooks/useCloseWhenGone";
import { useFolderStore } from "@/stores/folderStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useMobileFolderScope } from "@/components/mobile/folders/useMobileFolderScope";
import { AvatarTile } from "@/components/shared/AvatarTile";
import MobileFilterBar from "@/components/mobile/MobileFilterBar";
import MobilePanelHeader from "@/components/mobile/panels/MobilePanelHeader";
import RuleActionsSheet from "@/components/mobile/sheets/RuleActionsSheet";
import AddChoiceSheet from "@/components/mobile/sheets/AddChoiceSheet";
import FolderFormSheet, { type FolderEdit } from "@/components/mobile/sheets/FolderFormSheet";
import FolderActionsSheet from "@/components/mobile/sheets/FolderActionsSheet";
import MobileFolderBreadcrumb from "@/components/mobile/folders/MobileFolderBreadcrumb";
import MobileFolderRow from "@/components/mobile/folders/MobileFolderRow";
import FolderBackTrap from "@/components/mobile/folders/FolderBackTrap";
import { RuleForm } from "@/components/port_forwarding/RuleForm";
import { scopeItems, folderItemCount } from "@/components/mobile/folders/mobileFolderCore";
import type { PortForwardingRule, Folder } from "@/types";
import { compareStrings } from "@/utils/localeFormat";
import { searchMatcher } from "@/utils/search";

type FormRule = PortForwardingRule | null | "new" | undefined;
type AddMode = null | "menu" | "new-folder";

export default function MobilePortForwardingScreen() {
  const { t } = useTranslation();
  const allFolders = useAllFolders();
  const { inScope, can, nav, folderIds: pfFolderIds, targetVaultId, canCreateFolder, canEditFolder } = useMobileFolderScope(allFolders, "port_forwarding");
  const everyRule = useAllPortForwardingRules();
  const allRules = useMemo(() => everyRule.filter(inScope), [everyRule, inScope]);
  const { statusFor, startRule, stopRule } = useRuleTunnels();
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

  const subfolders = useMemo(() => [...nav.visibleFolders].sort((a, b) => compareStrings(a.name, b.name)), [nav.visibleFolders]);

  const rules = useMemo(() => {
    const match = searchMatcher(search);
    return scopeItems(allRules, nav.activeFolderId, pfFolderIds)
      .filter((r) => match(r.name, r.local_port, r.remote_port, r.remote_host))
      .sort((a, b) => compareStrings(a.name, b.name));
  }, [allRules, nav.activeFolderId, pfFolderIds, search]);

  const canCreateRule = can("EDIT_CONNECTIONS", targetVaultId);
  const closeForm = () => { setFormRule(undefined); dirtyRef.current = false; };
  const shownRuleId = formRule && formRule !== "new" ? formRule.id : null;
  useCloseWhenGone(shownRuleId, allRules.some((r) => r.id === shownRuleId), closeForm);
  const createFolder = (edit: FolderEdit) =>
    void saveFolder({ ...edit, object_type: "port_forwarding", parent_folder_id: nav.activeFolderId ?? undefined, vault_id: targetVaultId });

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      {nav.folderPath.map((f) => <FolderBackTrap key={f.id} onBack={() => nav.setFolderPath((p) => p.slice(0, -1))} />)}
      <MobilePanelHeader
        title={t("mobile.morePages.portForwarding")}
        right={canCreateRule || canCreateFolder ? (
          <button data-pf-add onClick={() => setAddMode("menu")} className="p-2 text-(--t-text-primary)">
            <Icon icon="lucide:plus" width={22} />
          </button>
        ) : undefined}
      />
      <MobileFilterBar value={search} onChange={setSearch} placeholder={t("mobile.portForwardingScreen.filterPlaceholder")} />
      <MobileFolderBreadcrumb path={nav.folderPath} onNavigate={(i) => (i < 0 ? nav.navigateToRoot() : nav.navigateTo(i))} />
      <div className="px-4 py-1 text-xs text-(--t-text-dim)">{t("mobile.portForwardingScreen.summary", { total: allRules.length, active: allRules.filter((r) => statusFor(r).status === "active").length })}</div>

      <div className="flex-1 overflow-y-auto pb-4">
        {!search && subfolders.map((f) => (
          <MobileFolderRow key={f.id} folder={f} count={folderItemCount(allRules, f.id)} onOpen={() => nav.navigateInto(f)} onActions={canEditFolder(f) ? () => setFolderSheet(f) : undefined} />
        ))}

        {rules.map((rule) => {
          const st = statusFor(rule);
          return (
            <div key={rule.id} data-pf-rule className="w-full flex items-center gap-3 px-4 py-2.5">
              <AvatarTile icon="lucide:arrow-left-right" className="w-9 h-9 rounded-lg" iconSize={18} />
              <button className="flex-1 min-w-0 text-left" onClick={() => setSheetRule(rule)}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-(--t-text-primary) truncate">{rule.name}</span>
                  <span lang="en" className="shrink-0 rounded-sm px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-(--t-text-dim)" style={{ background: "var(--t-bg-card)" }}>{rule.tunnel_type}</span>
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
            <p className="text-sm">{search.trim() ? t("mobile.portForwardingScreen.noSearchMatches") : t("mobile.portForwardingScreen.empty")}</p>
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
          items={canCreateRule ? [{ slug: "item", icon: "lucide:arrow-left-right", label: t("mobile.portForwardingScreen.newRuleLabel"), onTap: () => { setAddMode(null); setFormRule("new"); } }] : []}
          onNewFolder={canCreateFolder ? () => setAddMode("new-folder") : undefined}
          onClose={() => setAddMode(null)}
        />
      )}
      {addMode === "new-folder" && (
        <FolderFormSheet title={t("mobile.snippets.newFolderTitle")} submitLabel={t("common.action.create")} onSubmit={createFolder} onClose={() => setAddMode(null)} />
      )}
      {folderSheet && (
        <FolderActionsSheet
          folder={folderSheet}
          onSave={(edit) => void updateFolder(folderSheet.id, { ...edit, object_type: "port_forwarding" })}
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
