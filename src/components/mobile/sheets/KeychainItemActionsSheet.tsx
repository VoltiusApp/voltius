import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import MoveToFolderSheet from "./MoveToFolderSheet";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useFolderStore } from "@/stores/folderStore";
import { useAllFolders } from "@/hooks/useAllFolders";
import { getSecret } from "@/services/vault";
import { writeClipboard } from "@/utils/clipboard";
import { buildMoveTargets } from "@/components/mobile/folders/mobileFolderCore";
import type { SshKey, Identity } from "@/types";

type Mode = "menu" | "confirm-delete" | "move-folder";

type RowItem = { icon: string; label: string; danger?: boolean; slug: string; onTap: () => void };

type Props =
  | { kind: "key"; item: SshKey; onClose: () => void }
  | { kind: "identity"; item: Identity; onClose: () => void };

function toast(message: string, severity: "success" | "error") {
  useNotificationStore.getState().addToast({ pluginId: "core", pluginName: "Voltius", type: "toast", message, severity, duration: 2000 });
}

export default function KeychainItemActionsSheet(props: Props) {
  const { kind, item, onClose } = props;
  const { t } = useTranslation();
  const deleteKey = useKeyStore((s) => s.deleteKey);
  const deleteIdentity = useIdentityStore((s) => s.deleteIdentity);
  const moveObjectsToFolder = useFolderStore((s) => s.moveObjectsToFolder);
  const allFolders = useAllFolders();
  const [mode, setMode] = useState<Mode>("menu");

  const name = item.name ?? (kind === "key" ? t("mobile.sheets.keychainActions.unnamedKey") : (item as Identity).username);

  const Row = ({ it }: { it: RowItem }) => (
    <button
      data-keychain-action={it.slug}
      className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left active:bg-(--t-bg-card)"
      style={{ color: it.danger ? "var(--t-danger, #e5484d)" : "var(--t-text-primary)" }}
      onClick={it.onTap}
    >
      <Icon icon={it.icon} width={18} />
      <span className="text-sm font-medium">{it.label}</span>
    </button>
  );

  if (mode === "move-folder") {
    return (
      <MoveToFolderSheet
        targets={buildMoveTargets(allFolders, "keychain")}
        currentFolderId={item.folder_id ?? null}
        onPick={(folderId) => { void (async () => { await moveObjectsToFolder([item.id], kind === "key" ? "key" : "identity", folderId); if (kind === "key") await useKeyStore.getState().loadKeys(); else await useIdentityStore.getState().loadIdentities(); })(); }}
        onClose={onClose}
      />
    );
  }

  if (mode === "confirm-delete") {
    return (
      <BottomSheet title={kind === "key" ? t("mobile.sheets.keychainActions.deleteKeyTitle") : t("mobile.sheets.keychainActions.deleteIdentityTitle")} onClose={onClose}>
        <div className="px-3 pt-1 pb-2 text-sm text-(--t-text-dim)">
          {t("mobile.sheets.shared.confirmDeleteBody", { name })}
        </div>
        <Row it={{ icon: "lucide:trash-2", label: t("common.action.delete"), danger: true, slug: "delete-confirm", onTap: () => {
          if (kind === "key") void deleteKey(item.id);
          else void deleteIdentity(item.id);
          onClose();
        } }} />
        <Row it={{ icon: "lucide:x", label: t("common.action.cancel"), slug: "cancel", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  const items: RowItem[] = [
    kind === "key"
      ? { icon: "lucide:clipboard-copy", label: t("mobile.sheets.keychainActions.copyPublicKey"), slug: "copy-public-key", onTap: async () => {
          const pub = await getSecret(`key:${item.id}:public`);
          if (pub) { await writeClipboard(pub); toast(t("mobile.sheets.keychainActions.copiedPublicKey"), "success"); }
          else { toast(t("mobile.sheets.keychainActions.noPublicKeyStored"), "error"); }
          onClose();
        } }
      : { icon: "lucide:clipboard-copy", label: t("mobile.sheets.keychainActions.copyUsername"), slug: "copy-username", onTap: async () => {
          await writeClipboard((item as Identity).username);
          toast(t("mobile.sheets.keychainActions.copiedUsername"), "success");
          onClose();
        } },
    { icon: "lucide:folder-tree", label: t("mobile.sheets.shared.moveToFolder"), slug: "move-folder", onTap: () => setMode("move-folder") },
    { icon: "lucide:trash-2", label: t("common.action.delete"), danger: true, slug: "delete", onTap: () => setMode("confirm-delete") },
  ];

  return (
    <BottomSheet title={name} onClose={onClose}>
      {items.map((it) => <Row key={it.slug} it={it} />)}
    </BottomSheet>
  );
}
