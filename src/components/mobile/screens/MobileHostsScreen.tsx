import { useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useOpenHost } from "../useOpenHost";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useAllFolders } from "@/hooks/useAllFolders";
import { useFolderStore } from "@/stores/folderStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useEffectivePinnedPredicate } from "@/hooks/useEffectivePinned";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { StatusDot } from "@/components/shared/StatusDot";
import { pingStatusMotion, pingStatusTone } from "@/utils/statusTone";
import { scopeItems } from "@/components/mobile/folders/mobileFolderCore";
import { folderItemCounter } from "@/utils/folderTree";
import { useMobileFolderScope } from "@/components/mobile/folders/useMobileFolderScope";
import MobileFolderBreadcrumb from "@/components/mobile/folders/MobileFolderBreadcrumb";
import MobileFolderRow from "@/components/mobile/folders/MobileFolderRow";
import FolderBackTrap from "@/components/mobile/folders/FolderBackTrap";
import FolderFormSheet, { type FolderEdit } from "@/components/mobile/sheets/FolderFormSheet";
import FolderActionsSheet from "@/components/mobile/sheets/FolderActionsSheet";
import AddChoiceSheet from "@/components/mobile/sheets/AddChoiceSheet";
import type { Connection, Folder } from "@/types";
import { APPBAR_TONAL, MobileLargeTitle, MobileLargeTopBar } from "../MobileHeader";
import MobileFilterBar from "../MobileFilterBar";
import RowActionsButton from "../RowActionsButton";
import { useLongPress } from "../useLongPress";
import { useCollapsingHeader } from "../useCollapsingHeader";
import MobileRemoteDeviceSessions from "../MobileRemoteDeviceSessions";
import { TeamCredentialsNote } from "@/components/shared/VaultUnavailableNote";
import { useTeamCredentialsUnavailable } from "@/hooks/useBlockedTeamVault";
import { compareStrings } from "@/utils/localeFormat";
import { searchMatcher } from "@/utils/search";
import { ManagedBadge } from "@/components/sshConfig/ManagedHost";

function MobileHostRow({
  c,
  pinned,
  pingEnabled,
  onConnect,
  onActions,
}: {
  c: Connection;
  pinned: boolean;
  pingEnabled: boolean;
  onConnect: (id: string) => void;
  onActions: (id: string) => void;
}) {
  const { t } = useTranslation();
  const pingStatus = useHostPingStore((s) => s.statuses[c.id]);
  const pingLatency = useHostPingStore((s) => s.latencies[c.id]);
  // Tap connects; long-press opens the host actions sheet (M3: no ⋮ on every row).
  const press = useLongPress(() => onActions(c.id), () => onConnect(c.id));

  const isSerial = c.connection_type === "serial";
  const showPingDot = !isSerial && pingEnabled && !c.ping_disabled;

  const named = !!c.name?.trim();
  const name = connectionDisplayName(c);
  // Unnamed hosts already show "user@host" as their display name — don't repeat it.
  const subtitle = named ? `${c.username}@${c.host}${c.port !== 22 ? `:${c.port}` : ""}` : "";
  const latency = showPingDot && pingStatus === "up" && pingLatency !== undefined ? `${pingLatency} ms` : null;

  return (
    <div className="relative flex items-center" data-mobile-host={c.id}>
      <button className="flex-1 flex items-center gap-4 min-h-[72px] px-4 py-2 text-left min-w-0" aria-haspopup="menu" {...press}>
        <span className="relative shrink-0">
          <ConnectionAvatar connection={c} size={40} />
          {showPingDot && (
            <StatusDot
              tone={pingStatusTone(pingStatus)}
              motion={pingStatusMotion(pingStatus)}
              halo="var(--t-bg-base)"
              corner
            />
          )}
        </span>
        <span className="flex-1 flex flex-col min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-base font-medium text-(--t-text-primary) truncate">{name}</span>
            {pinned && <Icon icon="lucide:pin" width={14} className="shrink-0 text-(--t-accent)" />}
            <ManagedBadge id={c.id} compact />
          </span>
          {subtitle && <span className="text-sm text-(--t-text-dim) truncate">{subtitle}</span>}
        </span>
        {latency && <span data-mobile-host-latency className="shrink-0 tabular-nums text-xs font-medium text-(--t-text-dim)">{latency}</span>}
      </button>
      <RowActionsButton attr="data-mobile-host-actions" value={c.id} label={t("common.action.moreOptions")} name={name} onTap={() => onActions(c.id)} />
    </div>
  );
}

type AddMode = null | "menu" | "new-folder";

export default function MobileHostsScreen() {
  const { t } = useTranslation();
  const connections = useAllConnections();
  const allFolders = useAllFolders();
  const { inScope, can, nav, axisRef, openPath, folders: connFolders, folderIds: connFolderIds, targetVaultId, canCreateFolder, canEditFolder } = useMobileFolderScope(allFolders, "connection");
  const push = useMobileNavStore((s) => s.push);
  const openHost = useOpenHost();
  const openSheet = useMobileNavStore((s) => s.openSheet);
  const search = useMobileNavStore((s) => s.hostSearch);
  const setSearch = useMobileNavStore((s) => s.setHostSearch);
  const [pingEnabled] = useToggle("reachability");
  const isPinnedFn = useEffectivePinnedPredicate();
  const saveFolder = useFolderStore((s) => s.saveFolder);
  const updateFolder = useFolderStore((s) => s.updateFolder);
  const deleteFolder = useFolderStore((s) => s.deleteFolder);

  const [addMode, setAddMode] = useState<AddMode>(null);
  const [folderSheet, setFolderSheet] = useState<Folder | null>(null);

  const subFolders = useMemo(
    () => [...nav.visibleFolders].sort((a, b) => compareStrings(a.name, b.name)),
    [nav.visibleFolders],
  );

  const inVault = useMemo(() => connections.filter(inScope), [connections, inScope]);
  const folderCount = useMemo(() => folderItemCounter(inVault, connFolders), [inVault, connFolders]);

  const visible = useMemo(() => {
    const scoped = scopeItems(inVault, nav.activeFolderId, connFolderIds);
    const match = searchMatcher(search);
    const filtered = scoped.filter((c) => match(connectionDisplayName(c), c.host, ...(c.tags ?? [])));
    const sorted = [...filtered].sort((a, b) => compareStrings(connectionDisplayName(a), connectionDisplayName(b)));
    if (nav.activeFolderId) return sorted;
    const pinned = sorted.filter((c) => isPinnedFn(c, "connection"));
    const rest = sorted.filter((c) => !isPinnedFn(c, "connection"));
    return [...pinned, ...rest];
  }, [inVault, nav.activeFolderId, connFolderIds, search, isPinnedFn]);

  const teamCredentialsUnavailable = useTeamCredentialsUnavailable();

  const canCreateHost = can("EDIT_CONNECTIONS", targetVaultId);
  const canAdd = canCreateHost || canCreateFolder;
  // Same entry point the header "+" had: the Add sheet (new host / new folder).
  const fabLabel = canCreateHost ? t("mobile.host.newTitle") : t("mobile.snippets.newFolderTitle");
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const { onScroll, fabExtended } = useCollapsingHeader(rootRef, titleRef);
  const createFolder = (edit: FolderEdit) =>
    void saveFolder({ ...edit, object_type: "connection", parent_folder_id: nav.activeFolderId ?? undefined, vault_id: targetVaultId });

  return (
    <div ref={rootRef} data-mobile-hosts className="group/appbar relative flex-1 flex flex-col overflow-hidden">
      {openPath.map((f) => <FolderBackTrap key={f.id} onBack={nav.navigateUp} />)}
      <MobileLargeTopBar />
      <div data-mobile-hosts-scroll className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none" style={{ overscrollBehavior: "contain" }} onScroll={onScroll}>
        <MobileLargeTitle ref={titleRef} />
        <MobileFilterBar
          attr="mobile-host-search"
          value={search}
          onChange={setSearch}
          placeholder={t("mobile.hostsScreen.searchPlaceholder")}
          clearLabel={t("mobile.hostsScreen.clearSearchAriaLabel")}
          className={`sticky top-0 z-[1] bg-(--t-bg-base) ${APPBAR_TONAL}`}
        />
        <div ref={axisRef} data-mobile-folder-level>
          <MobileFolderBreadcrumb path={nav.folderPath} onNavigate={(i) => (i < 0 ? nav.navigateToRoot() : nav.navigateTo(i))} />
          {teamCredentialsUnavailable && <TeamCredentialsNote reason={teamCredentialsUnavailable} className="mx-4 mt-3" />}
          {!nav.activeFolderId && <MobileRemoteDeviceSessions />}
          {!search && subFolders.map((f) => (
            <MobileFolderRow
              key={f.id}
              folder={f}
              count={folderCount(f.id)}
              onOpen={() => nav.navigateInto(f)}
              onActions={canEditFolder(f) ? () => setFolderSheet(f) : undefined}
            />
          ))}
          {visible.length === 0 && subFolders.length === 0 && (
            <div className="flex flex-col items-center gap-2 pt-16 text-(--t-text-dim)">
              <Icon icon="lucide:server-off" width={28} />
              <span className="text-sm">{search ? t("mobile.snippets.noMatches") : t("mobile.hostsScreen.emptyNoHosts")}</span>
            </div>
          )}
          {visible.map((c) => (
            <MobileHostRow
              key={c.id}
              c={c}
              pinned={isPinnedFn(c, "connection")}
              pingEnabled={pingEnabled}
              onConnect={openHost}
              onActions={(id) => openSheet({ kind: "host-actions", hostId: id })}
            />
          ))}
          {/* Clearance so the last row can scroll out from under the FAB. */}
          {canAdd && <div aria-hidden className="h-24" />}
        </div>
      </div>
      {canAdd && (
        <button
          data-mobile-add
          data-mobile-fab={fabExtended ? "extended" : "collapsed"}
          data-snackbar-avoid
          aria-label={fabLabel}
          onClick={() => setAddMode("menu")}
          className="absolute right-4 bottom-4 z-10 h-14 flex items-center pl-4 rounded-2xl text-sm font-medium shadow-[0_6px_16px_-6px_rgba(0,0,0,0.5)] transition-[padding] duration-(--vt-dur-medium2) ease-(--vt-ease-emphasized)"
          style={{ background: "var(--t-accent)", color: "var(--t-on-accent, #fff)", paddingRight: fabExtended ? 20 : 16 }}
        >
          <Icon icon="lucide:plus" width={24} className="shrink-0" />
          <span
            aria-hidden
            className="overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin-left] duration-(--vt-dur-medium2) ease-(--vt-ease-emphasized)"
            style={{ maxWidth: fabExtended ? 200 : 0, opacity: fabExtended ? 1 : 0, marginLeft: fabExtended ? 12 : 0 }}
          >
            {fabLabel}
          </span>
        </button>
      )}

      {addMode === "menu" && (
        <AddChoiceSheet
          items={canCreateHost ? [{ slug: "item", icon: "lucide:server", label: t("mobile.host.newTitle"), onTap: () => { setAddMode(null); push({ kind: "host-edit" }); } }] : []}
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
          onSave={(edit) => void updateFolder(folderSheet.id, { ...edit, object_type: "connection" })}
          onDelete={() => { nav.onFolderDeleted(folderSheet.id); void deleteFolder(folderSheet.id); }}
          onClose={() => setFolderSheet(null)}
        />
      )}
    </div>
  );
}
