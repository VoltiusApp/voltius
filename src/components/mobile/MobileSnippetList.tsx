import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useAllSnippetFolders } from "@/hooks/useAllSnippetFolders";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { useVaultStore } from "@/stores/vaultStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { runSnippetIntoSessions } from "@/services/snippetRun";
import { scopeItems, folderItemCount } from "@/components/mobile/folders/mobileFolderCore";
import MobileFolderBreadcrumb from "@/components/mobile/folders/MobileFolderBreadcrumb";
import MobileFolderRow from "@/components/mobile/folders/MobileFolderRow";
import FolderBackTrap from "@/components/mobile/folders/FolderBackTrap";
import FolderFormSheet from "@/components/mobile/sheets/FolderFormSheet";
import FolderActionsSheet from "@/components/mobile/sheets/FolderActionsSheet";
import type { Snippet, Folder } from "@/types";
import { snippetSearchText } from "@/services/snippetSteps";

export default function MobileSnippetList({
  currentSessionId, addFolderOpen = false, onCloseAddFolder,
}: { currentSessionId?: string; addFolderOpen?: boolean; onCloseAddFolder?: () => void }) {
  const { t } = useTranslation();
  const snippets = useSnippetStore((s) => s.snippets);
  const allSnippetFolders = useAllSnippetFolders();
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const openSheet = useMobileNavStore((s) => s.openSheet);
  const setTab = useMobileNavStore((s) => s.setTab);
  const closeSheet = useMobileNavStore((s) => s.closeSheet);
  const saveFolder = useSnippetFolderStore((s) => s.saveFolder);
  const updateFolder = useSnippetFolderStore((s) => s.updateFolder);
  const deleteFolder = useSnippetFolderStore((s) => s.deleteFolder);
  const [search, setSearch] = useState("");
  const [folderSheet, setFolderSheet] = useState<Folder | null>(null);

  const foldersEnabled = !currentSessionId;

  const snFolders = useMemo(
    () => allSnippetFolders.filter((f) => f.object_type === "snippet" && selectedVaultIds.includes(f.vault_id ?? "personal")),
    [allSnippetFolders, selectedVaultIds],
  );
  const nav = useFolderNavigation(snFolders);

  const inVault = useMemo(
    () => snippets.filter((s) => !s.deleted_at && selectedVaultIds.includes(s.vault_id ?? "personal")),
    [snippets, selectedVaultIds],
  );

  const subFolders = useMemo(
    () => (foldersEnabled ? [...nav.visibleFolders].sort((a, b) => a.name.localeCompare(b.name)) : []),
    [foldersEnabled, nav.visibleFolders],
  );

  const visible = useMemo(() => {
    const scoped = foldersEnabled ? scopeItems(inVault, nav.activeFolderId) : inVault;
    const q = search.trim().toLowerCase();
    return (q ? scoped.filter((s) => s.name.toLowerCase().includes(q) || snippetSearchText(s).toLowerCase().includes(q)) : scoped)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [foldersEnabled, inVault, nav.activeFolderId, search]);

  const targetVaultId = nav.folderPath[nav.folderPath.length - 1]?.vault_id ?? selectedVaultIds[0] ?? "personal";
  const createFolder = (name: string) =>
    void saveFolder({ name, object_type: "snippet", parent_folder_id: nav.activeFolderId ?? undefined, vault_id: targetVaultId });

  function runCurrent(sn: Snippet, execute: boolean) {
    if (!currentSessionId) return;
    void runSnippetIntoSessions(sn, [currentSessionId], execute, {
      onNeedVars: (pi) => useSnippetStore.getState().setGlobalPendingInject(pi),
    });
    setTab("terminal");
    closeSheet();
  }
  function openPicker(snippetId: string, mode: "insert" | "execute") {
    openSheet({ kind: "snippet-target", snippetId, mode, preselectSessionId: currentSessionId });
  }
  const onInsert = (sn: Snippet) => currentSessionId ? runCurrent(sn, false) : openPicker(sn.id, "insert");
  const onExecute = (sn: Snippet) => currentSessionId ? runCurrent(sn, true) : openPicker(sn.id, "execute");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {foldersEnabled && nav.folderPath.map((f) => <FolderBackTrap key={f.id} onBack={() => nav.setFolderPath((p) => p.slice(0, -1))} />)}
      <div className="shrink-0 px-3 py-2">
        <div className="flex items-center gap-2 rounded-xl px-3 h-10" style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}>
          <Icon icon="lucide:search" width={16} className="text-(--t-text-dim)" />
          <input data-mobile-snippet-search value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t("mobile.snippets.searchPlaceholder")} className="flex-1 bg-transparent text-sm outline-none text-(--t-text-primary)" />
        </div>
      </div>
      {foldersEnabled && <MobileFolderBreadcrumb path={nav.folderPath} onNavigate={(i) => (i < 0 ? nav.navigateToRoot() : nav.navigateTo(i))} />}
      <div className="flex-1 overflow-y-auto">
        {foldersEnabled && !search && subFolders.map((f) => (
          <MobileFolderRow
            key={f.id}
            name={f.name}
            count={folderItemCount(inVault, f.id)}
            onOpen={() => nav.navigateInto(f)}
            onActions={() => setFolderSheet(f)}
          />
        ))}
        {visible.length === 0 && subFolders.length === 0 && (
          <div className="flex flex-col items-center gap-2 pt-16 text-(--t-text-dim)">
            <Icon icon="lucide:braces" width={28} />
            <span className="text-sm">{search ? t("mobile.snippets.noMatches") : t("mobile.snippets.empty")}</span>
          </div>
        )}
        {visible.map((sn) => (
          <div key={sn.id} className="flex items-center" data-mobile-snippet={sn.id}>
            <button className="flex-1 flex flex-col gap-0.5 px-4 py-3 text-left active:bg-(--t-bg-card) min-w-0"
              onClick={() => openPicker(sn.id, "execute")}>
              <span className="text-sm font-medium text-(--t-text-primary) truncate">{sn.name}</span>
              <span className="text-xs font-mono text-(--t-text-dim) truncate">{snippetSearchText(sn)}</span>
            </button>
            <button className="p-2.5 text-(--t-text-secondary)" data-mobile-snippet-insert={sn.id} aria-label={t("mobile.snippets.insertAriaLabel")} onClick={() => onInsert(sn)}>
              <Icon icon="lucide:arrow-down-to-line" width={18} />
            </button>
            <button className="p-2.5 text-(--t-accent)" data-mobile-snippet-execute={sn.id} aria-label={t("mobile.snippets.executeAriaLabel")} onClick={() => onExecute(sn)}>
              <Icon icon="lucide:play" width={18} />
            </button>
            {!currentSessionId && (
              <button className="p-2.5 text-(--t-text-dim)" data-mobile-snippet-more={sn.id} aria-label={t("mobile.snippets.moreAriaLabel")}
                onClick={() => openSheet({ kind: "snippet-actions", snippetId: sn.id })}>
                <Icon icon="lucide:ellipsis-vertical" width={18} />
              </button>
            )}
          </div>
        ))}
      </div>

      {foldersEnabled && addFolderOpen && (
        <FolderFormSheet title={t("mobile.snippets.newFolderTitle")} submitLabel={t("common.action.create")} onSubmit={createFolder} onClose={() => onCloseAddFolder?.()} />
      )}
      {foldersEnabled && folderSheet && (
        <FolderActionsSheet
          folder={folderSheet}
          onRename={(name) => void updateFolder(folderSheet.id, { name, object_type: "snippet", parent_folder_id: folderSheet.parent_folder_id, vault_id: folderSheet.vault_id })}
          onDelete={() => { nav.onFolderDeleted(folderSheet.id); void deleteFolder(folderSheet.id); }}
          onClose={() => setFolderSheet(null)}
        />
      )}
    </div>
  );
}
