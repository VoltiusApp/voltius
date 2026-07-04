import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useConnectionStore, connectionToFormData } from "@/stores/connectionStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useAllFolders } from "@/hooks/useAllFolders";
import { useFolderStore } from "@/stores/folderStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useEffectivePinned } from "@/hooks/useEffectivePinned";
import { useNotificationStore } from "@/stores/notificationStore";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { writeClipboard } from "@/utils/clipboard";
import { buildMoveTargets } from "@/components/mobile/folders/mobileFolderCore";
import MoveToFolderSheet from "./MoveToFolderSheet";

type Mode = "menu" | "confirm-delete" | "move" | "move-folder";

type Item = { icon: string; label: string; danger?: boolean; slug?: string; onTap: () => void };

export default function HostActionsSheet({ hostId }: { hostId: string }) {
  const { t } = useTranslation();
  const closeSheet = useMobileNavStore((s) => s.closeSheet);
  const push = useMobileNavStore((s) => s.push);
  const setTab = useMobileNavStore((s) => s.setTab);
  const connections = useAllConnections();
  const conn = connections.find((c) => c.id === hostId);
  const saveConnection = useConnectionStore((s) => s.saveConnection);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);
  const connect = useSessionStore((s) => s.connect);
  const vaults = useVaultStore((s) => s.vaults);
  const isSynced = useSyncPrefsStore((s) => s.isObjectSynced(hostId, "connection"));
  const pinConnection = useConnectionStore((s) => s.pinConnection);
  const effectivePinned = useEffectivePinned(conn ?? { id: hostId }, "connection");
  const allFolders = useAllFolders();
  const moveObjectsToFolder = useFolderStore((s) => s.moveObjectsToFolder);
  const folderTargets = buildMoveTargets(allFolders, "connection");
  const [mode, setMode] = useState<Mode>("menu");

  if (!conn) return null;
  const name = connectionDisplayName(conn);
  const isSerial = conn.connection_type === "serial" || !!conn.serial_port;
  const isFtp = conn.connection_type === "ftp";
  const currentVaultId = conn.vault_id ?? "personal";
  const moveTargets = vaults.filter((v) => v.id !== currentVaultId);

  const Row = ({ it }: { it: Item }) => (
    <button
      data-host-action={it.slug ?? it.label.toLowerCase().replace(/[^a-z]+/g, "-")}
      className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left active:bg-(--t-bg-card)"
      style={{ color: it.danger ? "var(--t-danger, #e5484d)" : "var(--t-text-primary)" }}
      onClick={it.onTap}
    >
      <Icon icon={it.icon} width={18} />
      <span className="text-sm font-medium">{it.label}</span>
    </button>
  );

  if (mode === "confirm-delete") {
    return (
      <BottomSheet title={t("mobile.sheets.hostActions.deleteTitle")} onClose={closeSheet} registerBack={false}>
        <div className="px-3 pt-1 pb-2 text-sm text-(--t-text-dim)">
          {t("mobile.sheets.shared.confirmDeleteBody", { name })}
        </div>
        <Row it={{ icon: "lucide:trash-2", label: t("common.action.delete"), danger: true, slug: "delete-confirm", onTap: () => { void deleteConnection(hostId); closeSheet(); } }} />
        <Row it={{ icon: "lucide:x", label: t("common.action.cancel"), slug: "cancel", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  if (mode === "move") {
    return (
      <BottomSheet title={t("mobile.sheets.shared.moveToVault")} onClose={closeSheet} registerBack={false}>
        {moveTargets.map((v) => (
          <Row key={v.id} it={{ icon: "lucide:vault", label: v.name, onTap: () => {
            void updateConnection(hostId, { ...connectionToFormData(conn), vault_id: v.id });
            closeSheet();
          } }} />
        ))}
        <Row it={{ icon: "lucide:arrow-left", label: t("mobile.sheets.shared.back"), slug: "back", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  if (mode === "move-folder") {
    return (
      <MoveToFolderSheet
        targets={folderTargets}
        currentFolderId={conn.folder_id ?? null}
        onPick={(folderId) => { void (async () => { await moveObjectsToFolder([hostId], "connection", folderId); await useConnectionStore.getState().loadConnections(); })(); }}
        onClose={closeSheet}
      />
    );
  }

  const items: Item[] = [
    ...(!isSerial && !isFtp ? [{ icon: "lucide:terminal", label: t("common.action.connect"), slug: "connect", onTap: () => { closeSheet(); void connect(hostId).catch(console.error); setTab("terminal"); } }] : []),
    { icon: "lucide:pencil", label: t("common.action.edit"), slug: "edit", onTap: () => { closeSheet(); push({ kind: "host-edit", hostId }); } },
    ...(!isSerial ? [{ icon: "lucide:folder-open", label: isFtp ? t("mobile.sheets.hostActions.openFiles") : t("mobile.panelItems.sftp"), slug: "sftp", onTap: () => { closeSheet(); push({ kind: "panel-sftp", connectionId: hostId }); } }] : []),
    ...(conn.host ? [{ icon: "lucide:clipboard-copy", label: t("mobile.sheets.hostActions.copyAddress"), slug: "copy-address", onTap: () => {
      void writeClipboard(conn.host);
      useNotificationStore.getState().addToast({ pluginId: "core", pluginName: "Voltius", type: "toast", message: t("mobile.sheets.hostActions.copiedAddress", { host: conn.host }), severity: "success", duration: 2000 });
      closeSheet();
    } }] : []),
    { icon: "lucide:copy", label: t("mobile.sheets.shared.duplicate"), slug: "duplicate", onTap: () => {
        void saveConnection({ ...connectionToFormData(conn), name: `${name} copy` });
        closeSheet();
      } },
    { icon: "lucide:folder-tree", label: t("mobile.sheets.shared.moveToFolder"), slug: "move-to-folder", onTap: () => setMode("move-folder") },
    { icon: effectivePinned ? "lucide:pin-off" : "lucide:pin", label: effectivePinned ? t("mobile.sheets.shared.unpin") : t("mobile.sheets.shared.pin"), slug: effectivePinned ? "unpin" : "pin", onTap: () => {
        pinConnection(hostId, !effectivePinned).catch(() => {});
      } },
    ...(moveTargets.length > 0 ? [{ icon: "lucide:folder-input", label: t("mobile.sheets.shared.moveToVault"), slug: "move-to-vault", onTap: () => setMode("move") }] : []),
    { icon: isSynced ? "lucide:cloud-off" : "lucide:cloud", label: isSynced ? t("mobile.sheets.hostActions.disableCloudSync") : t("mobile.sheets.hostActions.enableCloudSync"), slug: isSynced ? "disable-cloud-sync" : "enable-cloud-sync", onTap: () => {
        useSyncPrefsStore.getState().toggleExcluded(hostId);
      } },
    ...(!isSerial ? [{ icon: conn.ping_disabled ? "lucide:wifi" : "lucide:wifi-off", label: conn.ping_disabled ? t("mobile.sheets.hostActions.enableReachabilityCheck") : t("mobile.sheets.hostActions.disableReachabilityCheck"), slug: conn.ping_disabled ? "enable-reachability-check" : "disable-reachability-check", onTap: () => {
        void updateConnection(hostId, { ...connectionToFormData(conn), ping_disabled: !conn.ping_disabled });
      } }] : []),
    { icon: "lucide:trash-2", label: t("common.action.delete"), danger: true, slug: "delete", onTap: () => setMode("confirm-delete") },
  ];

  return (
    <BottomSheet title={name} onClose={closeSheet} registerBack={false}>
      {items.map((it) => <Row key={it.slug ?? it.label} it={it} />)}
    </BottomSheet>
  );
}
