import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useAllFolders } from "@/hooks/useAllFolders";
import { useFolderNavigation } from "@/hooks/useFolderNavigation";
import { useFolderStore } from "@/stores/folderStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useEffectivePinnedPredicate } from "@/hooks/useEffectivePinned";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { StatusDot } from "@/components/shared/StatusDot";
import { scopeItems, folderItemCount } from "@/components/mobile/folders/mobileFolderCore";
import MobileFolderBreadcrumb from "@/components/mobile/folders/MobileFolderBreadcrumb";
import MobileFolderRow from "@/components/mobile/folders/MobileFolderRow";
import FolderBackTrap from "@/components/mobile/folders/FolderBackTrap";
import FolderFormSheet from "@/components/mobile/sheets/FolderFormSheet";
import FolderActionsSheet from "@/components/mobile/sheets/FolderActionsSheet";
import AddChoiceSheet from "@/components/mobile/sheets/AddChoiceSheet";
import type { Connection, Folder } from "@/types";
import MobileHeader from "../MobileHeader";
import MobileRemoteDeviceSessions from "../MobileRemoteDeviceSessions";

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
  const pingStatus = useHostPingStore((s) => s.statuses[c.id]);
  const pingLatency = useHostPingStore((s) => s.latencies[c.id]);

  const isSerial = c.connection_type === "serial";
  const showPingDot = !isSerial && pingEnabled && !c.ping_disabled;
  const pingColor =
    pingStatus === "up"
      ? "var(--t-status-connected)"
      : pingStatus === "down"
      ? "var(--t-status-error)"
      : "var(--t-text-dim)";

  const named = !!c.name?.trim();
  const base = `${c.username}@${c.host}${c.port !== 22 ? `:${c.port}` : ""}`;
  const latency = showPingDot && pingStatus === "up" && pingLatency !== undefined ? ` · ${pingLatency}ms` : "";
  const subtitle = named ? `${base}${latency}` : latency.replace(/^ · /, "");

  return (
    <div className="flex items-center" data-mobile-host={c.id}>
      <button
        className="flex-1 flex items-center gap-3 px-4 py-3 text-left active:bg-(--t-bg-card)"
        onClick={() => onConnect(c.id)}
      >
        <span className="relative shrink-0">
          <ConnectionAvatar connection={c} size={34} />
          {showPingDot && <StatusDot color={pingColor} animate={pingStatus === "up"} size={9} />}
        </span>
        <span className="flex flex-col min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium text-(--t-text-primary) truncate">
              {connectionDisplayName(c)}
            </span>
            {pinned && <Icon icon="lucide:pin" width={12} className="shrink-0 text-(--t-accent)" />}
          </span>
          {/* Unnamed hosts already show "user@host" as their display name — don't repeat it. */}
          {subtitle && <span className="text-xs text-(--t-text-dim) truncate">{subtitle}</span>}
        </span>
      </button>
      <button
        data-mobile-host-actions={c.id}
        className="p-3 text-(--t-text-dim)"
        onClick={() => onActions(c.id)}
      >
        <Icon icon="lucide:ellipsis-vertical" width={18} />
      </button>
    </div>
  );
}

type AddMode = null | "menu" | "new-folder";

export default function MobileHostsScreen() {
  const { t } = useTranslation();
  const connections = useAllConnections();
  const allFolders = useAllFolders();
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const connect = useSessionStore((s) => s.connect);
  const setTab = useMobileNavStore((s) => s.setTab);
  const push = useMobileNavStore((s) => s.push);
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

  const connFolders = useMemo(
    () => allFolders.filter((f) => f.object_type === "connection" && selectedVaultIds.includes(f.vault_id ?? "personal")),
    [allFolders, selectedVaultIds],
  );
  const nav = useFolderNavigation(connFolders);

  const subFolders = useMemo(
    () => [...nav.visibleFolders].sort((a, b) => a.name.localeCompare(b.name)),
    [nav.visibleFolders],
  );

  const inVault = useMemo(
    () => connections.filter((c) => selectedVaultIds.includes(c.vault_id ?? "personal")),
    [connections, selectedVaultIds],
  );

  const visible = useMemo(() => {
    const scoped = scopeItems(inVault, nav.activeFolderId);
    const q = search.trim().toLowerCase();
    const filtered = q
      ? scoped.filter((c) =>
          connectionDisplayName(c).toLowerCase().includes(q) ||
          c.host.toLowerCase().includes(q) ||
          (c.tags ?? []).some((t) => t.toLowerCase().includes(q)))
      : scoped;
    const sorted = [...filtered].sort((a, b) => connectionDisplayName(a).localeCompare(connectionDisplayName(b)));
    if (nav.activeFolderId) return sorted;
    const pinned = sorted.filter((c) => isPinnedFn(c, "connection"));
    const rest = sorted.filter((c) => !isPinnedFn(c, "connection"));
    return [...pinned, ...rest];
  }, [inVault, nav.activeFolderId, search, isPinnedFn]);

  const handleConnect = (id: string) => {
    // FTP hosts have no terminal — open the file browser instead.
    const c = connections.find((x) => x.id === id);
    if (c?.connection_type === "ftp") {
      push({ kind: "panel-sftp", connectionId: id });
      return;
    }
    void connect(id).catch(console.error);
    setTab("terminal");
  };

  const targetVaultId = (nav.folderPath[nav.folderPath.length - 1]?.vault_id) ?? selectedVaultIds[0] ?? "personal";
  const createFolder = (name: string) =>
    void saveFolder({ name, object_type: "connection", parent_folder_id: nav.activeFolderId ?? undefined, vault_id: targetVaultId });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {nav.folderPath.map((f) => <FolderBackTrap key={f.id} onBack={() => nav.setFolderPath((p) => p.slice(0, -1))} />)}
      <MobileHeader onAdd={() => setAddMode("menu")} />
      <div className="shrink-0 px-3 py-2">
        <div className="flex items-center gap-2 rounded-xl px-3 h-10"
          style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}>
          <Icon icon="lucide:search" width={16} className="text-(--t-text-dim)" />
          <input data-mobile-host-search value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t("mobile.hostsScreen.searchPlaceholder")} className="flex-1 bg-transparent text-sm outline-none text-(--t-text-primary)" />
          {search && (
            <button data-mobile-host-search-clear onClick={() => setSearch("")}
              className="p-0.5 -mr-1 text-(--t-text-dim) active:text-(--t-text-primary)" aria-label={t("mobile.hostsScreen.clearSearchAriaLabel")}>
              <Icon icon="lucide:x" width={16} />
            </button>
          )}
        </div>
      </div>
      <MobileFolderBreadcrumb path={nav.folderPath} onNavigate={(i) => (i < 0 ? nav.navigateToRoot() : nav.navigateTo(i))} />
      <div className="flex-1 overflow-y-auto">
        {!nav.activeFolderId && <MobileRemoteDeviceSessions />}
        {!search && subFolders.map((f) => (
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
            onConnect={handleConnect}
            onActions={(id) => openSheet({ kind: "host-actions", hostId: id })}
          />
        ))}
      </div>

      {addMode === "menu" && (
        <AddChoiceSheet
          newItemLabel={t("mobile.host.newTitle")}
          newItemIcon="lucide:server"
          onNewItem={() => { setAddMode(null); push({ kind: "host-edit" }); }}
          onNewFolder={() => setAddMode("new-folder")}
          onClose={() => setAddMode(null)}
        />
      )}
      {addMode === "new-folder" && (
        <FolderFormSheet title={t("mobile.snippets.newFolderTitle")} submitLabel={t("common.action.create")} onSubmit={createFolder} onClose={() => setAddMode(null)} />
      )}
      {folderSheet && (
        <FolderActionsSheet
          folder={folderSheet}
          onRename={(name) => void updateFolder(folderSheet.id, { name, object_type: "connection", parent_folder_id: folderSheet.parent_folder_id, vault_id: folderSheet.vault_id })}
          onDelete={() => { nav.onFolderDeleted(folderSheet.id); void deleteFolder(folderSheet.id); }}
          onClose={() => setFolderSheet(null)}
        />
      )}
    </div>
  );
}
