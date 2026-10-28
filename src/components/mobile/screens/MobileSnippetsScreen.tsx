import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useVaultScope } from "@/hooks/useVaultScope";
import { usePermissions } from "@/hooks/usePermission";
import { CommunityBrowser } from "@/components/snippets/community/CommunityBrowser";
import MobileHeader from "../MobileHeader";
import MobileSnippetList from "../MobileSnippetList";
import MobileFilterBar from "../MobileFilterBar";
import AddChoiceSheet from "../sheets/AddChoiceSheet";

type SnippetsTab = "mine" | "community";

function SnippetsTabs({ value, onChange }: { value: SnippetsTab; onChange: (v: SnippetsTab) => void }) {
  const { t } = useTranslation();
  const tabs: { value: SnippetsTab; label: string }[] = [
    { value: "mine", label: t("snippets.community.tabMine") },
    { value: "community", label: t("snippets.community.tabCommunity") },
  ];
  return (
    <div role="tablist" className="shrink-0 flex border-b" style={{ borderColor: "var(--t-border)" }}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={selected}
            data-mobile-snippets-tab={tab.value}
            onClick={() => onChange(tab.value)}
            className={`relative flex-1 h-12 text-sm font-medium ${selected ? "text-(--t-accent)" : "text-(--t-text-secondary)"}`}
          >
            {tab.label}
            {selected && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] w-14 rounded-t-full bg-(--t-accent)" />}
          </button>
        );
      })}
    </div>
  );
}

export default function MobileSnippetsScreen() {
  const { t } = useTranslation();
  const push = useMobileNavStore((s) => s.push);
  const { createVaultId } = useVaultScope();
  const can = usePermissions();
  const canCreateSnippet = can("EDIT_SNIPPETS", createVaultId);
  const canCreateFolder = can("EDIT_FOLDERS", createVaultId);
  const [tab, setTab] = useState<SnippetsTab>("mine");
  const [communitySearch, setCommunitySearch] = useState("");
  const [addMenu, setAddMenu] = useState(false);
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const showAdd = tab === "mine" && (canCreateSnippet || canCreateFolder);
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MobileHeader onAdd={showAdd ? () => setAddMenu(true) : undefined} />
      <SnippetsTabs value={tab} onChange={setTab} />
      {tab === "mine" ? (
        <MobileSnippetList addFolderOpen={addFolderOpen} onCloseAddFolder={() => setAddFolderOpen(false)} />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col px-4 pb-4" data-mobile-community>
          <CommunityBrowser
            search={communitySearch}
            layout="list"
            onInstalled={() => setTab("mine")}
            toolbar={
              <MobileFilterBar value={communitySearch} onChange={setCommunitySearch} attr="mobile-community-search" inset="pt-2"
                placeholder={t("snippets.community.searchPlaceholder")} />
            }
          />
        </div>
      )}
      {addMenu && (
        <AddChoiceSheet
          items={canCreateSnippet ? [{ slug: "item", icon: "lucide:braces", label: t("mobile.snippetsScreen.newSnippetLabel"), onTap: () => { setAddMenu(false); push({ kind: "snippet-edit" }); } }] : []}
          onNewFolder={canCreateFolder ? () => { setAddMenu(false); setAddFolderOpen(true); } : undefined}
          onClose={() => setAddMenu(false)}
        />
      )}
    </div>
  );
}
