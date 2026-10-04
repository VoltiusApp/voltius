import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import MobilePanelHeader from "../panels/MobilePanelHeader";
import MobileFilterBar from "../MobileFilterBar";
import KeychainItemActionsSheet from "../sheets/KeychainItemActionsSheet";
import AddChoiceSheet from "../sheets/AddChoiceSheet";
import FolderFormSheet, { type FolderEdit } from "../sheets/FolderFormSheet";
import FolderActionsSheet from "../sheets/FolderActionsSheet";
import MobileFolderBreadcrumb from "../folders/MobileFolderBreadcrumb";
import MobileFolderRow from "../folders/MobileFolderRow";
import FolderBackTrap from "../folders/FolderBackTrap";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { useAllKeys } from "@/hooks/useAllKeys";
import { useAllIdentities } from "@/hooks/useAllIdentities";
import { useAllFolders } from "@/hooks/useAllFolders";
import { useFolderStore } from "@/stores/folderStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useMobileFolderScope } from "../folders/useMobileFolderScope";
import { scopeItems, folderItemCount } from "../folders/mobileFolderCore";
import type { SshKey, Identity, Folder } from "@/types";
import { compareStrings, formatDate } from "@/utils/localeFormat";
import { useSearchMatcher } from "@/utils/search";

type Sheet = { kind: "key"; item: SshKey } | { kind: "identity"; item: Identity } | null;

function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="flex items-center gap-1 flex-wrap">
      {tags.slice(0, 3).map((t) => (
        <span key={t} className="px-1.5 py-0.5 rounded text-[10px] text-(--t-text-dim)" style={{ background: "var(--t-bg-card)" }}>{t}</span>
      ))}
    </span>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-4 pb-1">
      <span className="text-[11px] font-semibold tracking-wide text-(--t-text-dim)">{label}</span>
      <span className="px-1.5 py-0.5 rounded-full text-[10px] text-(--t-text-dim)" style={{ background: "var(--t-bg-card)" }}>{count}</span>
    </div>
  );
}

export default function MobileKeychainScreen() {
  const { t } = useTranslation();
  const allFolders = useAllFolders();
  const { inScope, can, nav, folderIds: kcFolderIds, targetVaultId, canCreateFolder, canEditFolder } = useMobileFolderScope(allFolders, "keychain");
  const allKeys = useAllKeys();
  const allIdentities = useAllIdentities();
  const keys = useMemo(() => allKeys.filter(inScope), [allKeys, inScope]);
  const identities = useMemo(() => allIdentities.filter(inScope), [allIdentities, inScope]);
  const push = useMobileNavStore((s) => s.push);
  const saveFolder = useFolderStore((s) => s.saveFolder);
  const updateFolder = useFolderStore((s) => s.updateFolder);
  const deleteFolder = useFolderStore((s) => s.deleteFolder);

  const [search, setSearch] = useState("");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [folderSheet, setFolderSheet] = useState<Folder | null>(null);

  const subFolders = useMemo(() => [...nav.visibleFolders].sort((a, b) => compareStrings(a.name, b.name)), [nav.visibleFolders]);

  const q = search.trim();
  const match = useSearchMatcher(q);

  const scopedKeys = useMemo(
    () => scopeItems(keys, nav.activeFolderId, kcFolderIds)
      .filter((k) => match(k.name, k.key_type, ...k.tags))
      .sort((a, b) => compareStrings(a.name ?? "", b.name ?? "")),
    [keys, nav.activeFolderId, kcFolderIds, match],
  );
  const scopedIdentities = useMemo(
    () => scopeItems(identities, nav.activeFolderId, kcFolderIds)
      .filter((i) => match(i.name, i.username, ...i.tags))
      .sort((a, b) => compareStrings(a.name ?? a.username, b.name ?? b.username)),
    [identities, nav.activeFolderId, kcFolderIds, match],
  );

  const isEmpty = subFolders.length === 0 && scopedKeys.length === 0 && scopedIdentities.length === 0;
  const folderCount = (id: string) => folderItemCount(keys, id) + folderItemCount(identities, id);

  const canCreateKey = can("EDIT_KEYS", targetVaultId);
  const canCreateIdentity = can("EDIT_IDENTITIES", targetVaultId);
  const createFolder = (edit: FolderEdit) =>
    void saveFolder({ ...edit, object_type: "keychain", parent_folder_id: nav.activeFolderId ?? undefined, vault_id: targetVaultId });

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      {nav.folderPath.map((f) => <FolderBackTrap key={f.id} onBack={() => nav.setFolderPath((p) => p.slice(0, -1))} />)}
      <MobilePanelHeader
        title={t("mobile.morePages.keychain")}
        right={canCreateKey || canCreateIdentity || canCreateFolder ? (
          <button data-keychain-add onClick={() => setAddMenuOpen(true)} className="p-2 text-(--t-text-primary)">
            <Icon icon="lucide:plus" width={20} />
          </button>
        ) : undefined}
      />
      <MobileFilterBar value={search} onChange={setSearch} placeholder={t("mobile.keychainScreen.filterPlaceholder")} />
      <MobileFolderBreadcrumb path={nav.folderPath} onNavigate={(i) => (i < 0 ? nav.navigateToRoot() : nav.navigateTo(i))} />

      <div className="flex-1 overflow-y-auto pb-4">
        {!search && subFolders.length > 0 && (
          <div className="px-2 pt-1">
            {subFolders.map((f) => (
              <MobileFolderRow key={f.id} folder={f} count={folderCount(f.id)} onOpen={() => nav.navigateInto(f)} onActions={canEditFolder(f) ? () => setFolderSheet(f) : undefined} />
            ))}
          </div>
        )}

        {scopedKeys.length > 0 && (
          <div className="px-2">
            <SectionHeader label={t("mobile.keychainScreen.sshKeysHeader")} count={scopedKeys.length} />
            {scopedKeys.map((k) => (
              <button key={k.id} data-keychain-key className="w-full flex items-center gap-3 px-2 py-3 rounded-xl text-left active:bg-(--t-bg-card)" onClick={() => setSheet({ kind: "key", item: k })}>
                <AvatarTile icon="lucide:key-round" className="w-9 h-9 rounded-lg" iconSize={18} />
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-(--t-text-primary) truncate">{k.name ?? t("mobile.sheets.keychainActions.unnamedKey")}</span>
                  <span className="text-[11px] text-(--t-text-dim) truncate">{k.key_type ? `${k.key_type} · ` : ""}{t("mobile.keychainScreen.addedOn", { date: formatDate(k.created_at) })}</span>
                  <TagChips tags={k.tags} />
                </span>
              </button>
            ))}
          </div>
        )}

        {scopedIdentities.length > 0 && (
          <div className="px-2">
            <SectionHeader label={t("mobile.keychainScreen.identitiesHeader")} count={scopedIdentities.length} />
            {scopedIdentities.map((i) => (
              <button key={i.id} data-keychain-identity className="w-full flex items-center gap-3 px-2 py-3 rounded-xl text-left active:bg-(--t-bg-card)" onClick={() => setSheet({ kind: "identity", item: i })}>
                <AvatarTile icon="lucide:user" className="w-9 h-9 rounded-lg" iconSize={18} />
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-(--t-text-primary) truncate">{i.name ?? i.username}</span>
                  {i.name && <span className="text-[11px] text-(--t-text-dim) truncate">{i.username}</span>}
                  <TagChips tags={i.tags} />
                </span>
              </button>
            ))}
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center justify-center text-center px-8 pt-20 gap-1">
            <Icon icon="lucide:key-round" width={28} className="text-(--t-text-dim)" />
            <span className="text-sm text-(--t-text-dim)">{q ? t("mobile.keychainScreen.noSearchMatches") : t("mobile.keychainScreen.empty")}</span>
          </div>
        )}
      </div>

      {sheet && (sheet.kind === "key"
        ? <KeychainItemActionsSheet kind="key" item={sheet.item} onClose={() => setSheet(null)} />
        : <KeychainItemActionsSheet kind="identity" item={sheet.item} onClose={() => setSheet(null)} />)}

      {addMenuOpen && (
        <AddChoiceSheet
          items={[
            ...(canCreateKey ? [
              { slug: "generate-key", icon: "lucide:sparkles", label: t("mobile.keychainScreen.generateKey"), onTap: () => { setAddMenuOpen(false); push({ kind: "key-edit", mode: "generate" }); } },
              { slug: "import-key", icon: "lucide:import", label: t("mobile.keychainScreen.importKey"), onTap: () => { setAddMenuOpen(false); push({ kind: "key-edit", mode: "import" }); } },
            ] : []),
            ...(canCreateIdentity ? [
              { slug: "identity", icon: "lucide:user-plus", label: t("mobile.keychainScreen.newIdentity"), onTap: () => { setAddMenuOpen(false); push({ kind: "identity-edit" }); } },
            ] : []),
          ]}
          onNewFolder={canCreateFolder ? () => { setAddMenuOpen(false); setAddFolderOpen(true); } : undefined}
          onClose={() => setAddMenuOpen(false)}
        />
      )}
      {addFolderOpen && <FolderFormSheet title={t("mobile.snippets.newFolderTitle")} submitLabel={t("common.action.create")} onSubmit={createFolder} onClose={() => setAddFolderOpen(false)} />}
      {folderSheet && (
        <FolderActionsSheet
          folder={folderSheet}
          onSave={(edit) => void updateFolder(folderSheet.id, { ...edit, object_type: "keychain" })}
          onDelete={() => { nav.onFolderDeleted(folderSheet.id); void deleteFolder(folderSheet.id); }}
          onClose={() => setFolderSheet(null)}
        />
      )}
    </div>
  );
}
