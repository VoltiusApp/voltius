import { useState } from "react";
import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useConnectionStore, connectionToFormData } from "@/stores/connectionStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useAllFolders } from "@/hooks/useAllFolders";
import { useFolderStore } from "@/stores/folderStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useOtherVaultOptions } from "@/hooks/useVaultOptions";
import { usePermissions } from "@/hooks/usePermission";
import { useCanConnect } from "@/hooks/useCanConnect";
import { isTeamVaultId } from "@/stores/teamVaultMap";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useEffectivePinned } from "@/hooks/useEffectivePinned";
import { APP_SOURCE, useNotificationStore } from "@/stores/notificationStore";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { writeClipboard } from "@/utils/clipboard";
import { buildMoveTargets } from "@/components/mobile/folders/mobileFolderCore";
import VaultTransferSheet from "./VaultTransferSheet";
import { compareStrings } from "@/utils/localeFormat";
import MoveToFolderSheet from "./MoveToFolderSheet";
import { SheetActionRow, type SheetAction } from "./SheetActionRow";
import { copyingRulesOf } from "@/services/ruleSetIntent";
import { isFileOnlyProtocol, isWebProtocol } from "@/utils/connectionType";
import { SFTP_ICON } from "@/lib/conceptIcons";
import { connectionTarget } from "@/services/previewGuard";
import { objectSyncItem } from "@/utils/objectSyncItem";
import { previewGuarded } from "./previewGuardedActions";

type Mode = "menu" | "confirm-delete" | "move" | "move-folder";

const Row = ({ it }: { it: SheetAction }) => <SheetActionRow attr="host-action" it={it} />;

/** Rows left out when the sheet is the edit screen's ⋮: the screen is the editor, and the
 *  form holds its own folder / vault / ping state, which its next autosave would write back. */
const EDITOR_HIDDEN = new Set(["edit", "move-to-folder", "move-to-vault", "enable-reachability-check", "disable-reachability-check"]);

export default function HostActionsSheet({ hostId, fromEditor = false }: { hostId: string; fromEditor?: boolean }) {
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
  const isSynced = useSyncPrefsStore((s) => s.isObjectSynced(hostId, "connection"));
  const pinConnection = useConnectionStore((s) => s.pinConnection);
  const effectivePinned = useEffectivePinned(conn ?? { id: hostId }, "connection");
  const allFolders = useAllFolders();
  const moveObjectsToFolder = useFolderStore((s) => s.moveObjectsToFolder);
  const moveTargets = useOtherVaultOptions(conn?.vault_id);
  const can = usePermissions();
  const canConnect = useCanConnect(conn ?? { id: hostId, vault_id: "personal" });
  const [mode, setMode] = useState<Mode>("menu");

  if (!conn) return null;
  const name = connectionDisplayName(conn);
  const isSerial = conn.connection_type === "serial" || !!conn.serial_port;
  const fileOnly = isFileOnlyProtocol(conn);
  const isWeb = isWebProtocol(conn);
  const currentVaultId = conn.vault_id ?? "personal";
  const canEdit = can("EDIT_CONNECTIONS", currentVaultId, conn.id);
  const isTeamHost = isTeamVaultId(conn.vault_id);

  if (mode === "confirm-delete") {
    return (
      <BottomSheet title={t("mobile.sheets.hostActions.deleteTitle")} onClose={closeSheet}>
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
      <VaultTransferSheet tab="hosts" ids={[hostId]} mode="cut" targets={moveTargets} attr="host-action"
        onBack={() => setMode("menu")} onClose={closeSheet} />
    );
  }

  if (mode === "move-folder") {
    return (
      <MoveToFolderSheet
        targets={buildMoveTargets(allFolders, "connection", currentVaultId, compareStrings)}
        currentFolderId={conn.folder_id ?? null}
        onPick={async (folderId) => { await moveObjectsToFolder([hostId], "connection", folderId); await useConnectionStore.getState().loadConnections(); }}
        onClose={closeSheet}
      />
    );
  }

  const items: SheetAction[] = previewGuarded([
    ...(canConnect && !isSerial && !fileOnly ? [{ icon: "lucide:terminal", label: t("common.action.connect"), slug: "connect", onTap: () => { closeSheet(); void connect(hostId).catch(console.error); if (!isWeb) setTab("terminal"); } }] : []),
    ...(canEdit ? [{ icon: "lucide:pencil", label: t("common.action.edit"), slug: "edit", onTap: () => { closeSheet(); push({ kind: "host-edit", hostId }); } }] : []),
    ...(canConnect && !isSerial && !isWeb ? [{ icon: SFTP_ICON, label: fileOnly ? t("mobile.sheets.hostActions.openFiles") : t("mobile.panelItems.sftp"), slug: fileOnly ? "open-files" : "sftp", onTap: () => { closeSheet(); push({ kind: "panel-sftp", connectionId: hostId }); } }] : []),
    ...(conn.host ? [{ icon: "lucide:clipboard-copy", label: t("mobile.sheets.hostActions.copyAddress"), slug: "copy-address", reads: true, onTap: () => {
      void writeClipboard(conn.host);
      useNotificationStore.getState().addToast({ source: APP_SOURCE, type: "toast", message: t("mobile.sheets.hostActions.copiedAddress", { host: conn.host }), severity: "success", duration: 2000 });
      closeSheet();
    } }] : []),
    ...(canEdit ? [
      { icon: "lucide:copy", label: t("mobile.sheets.shared.duplicate"), slug: "duplicate", onTap: () => {
          void saveConnection(copyingRulesOf({ ...connectionToFormData(conn), name: `${name} copy` }, conn.id));
          closeSheet();
        } },
      { icon: "lucide:folder-tree", label: t("mobile.sheets.shared.moveToFolder"), slug: "move-to-folder", onTap: () => setMode("move-folder") },
    ] : []),
    { icon: effectivePinned ? "lucide:pin-off" : "lucide:pin", label: effectivePinned ? t("mobile.sheets.shared.unpin") : t("mobile.sheets.shared.pin"), slug: effectivePinned ? "unpin" : "pin", onTap: () => {
        pinConnection(hostId, !effectivePinned).catch(() => {});
      } },
    ...(canEdit && moveTargets.length > 0 ? [{ icon: "lucide:folder-input", label: t("mobile.sheets.shared.moveToVault"), slug: "move-to-vault", onTap: () => setMode("move") }] : []),
    ...(!isTeamHost ? [{ ...objectSyncItem(isSynced, t), slug: isSynced ? "disable-cloud-sync" : "enable-cloud-sync", onTap: () => {
        useSyncPrefsStore.getState().toggleExcluded(hostId);
      } }] : []),
    ...(canEdit && !isSerial ? [{ icon: conn.ping_disabled ? "lucide:wifi" : "lucide:wifi-off", label: conn.ping_disabled ? t("mobile.sheets.hostActions.enableReachabilityCheck") : t("mobile.sheets.hostActions.disableReachabilityCheck"), slug: conn.ping_disabled ? "enable-reachability-check" : "disable-reachability-check", onTap: () => {
        void updateConnection(hostId, { ...connectionToFormData(conn), ping_disabled: !conn.ping_disabled });
      } }] : []),
    ...(canEdit ? [{ icon: "lucide:trash-2", label: t("common.action.delete"), danger: true, slug: "delete", onTap: () => setMode("confirm-delete") }] : []),
  ], connectionTarget(hostId), closeSheet);

  return (
    <BottomSheet title={name} onClose={closeSheet}>
      {items.filter((it) => !fromEditor || !EDITOR_HIDDEN.has(it.slug ?? "")).map((it) => <Row key={it.slug ?? it.label} it={it} />)}
    </BottomSheet>
  );
}
