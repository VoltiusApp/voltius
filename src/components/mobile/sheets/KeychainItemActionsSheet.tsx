import { useState } from "react";
import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import MoveToFolderSheet from "./MoveToFolderSheet";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { APP_SOURCE, useNotificationStore } from "@/stores/notificationStore";
import { useFolderStore } from "@/stores/folderStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useAllFolders } from "@/hooks/useAllFolders";
import { ensurePublicKey } from "@/services/publicKeyStore";
import { writeClipboard } from "@/utils/clipboard";
import { canShare, publicKeyShareText, shareText } from "@/services/share";
import { buildMoveTargets } from "@/components/mobile/folders/mobileFolderCore";
import { usePermissions } from "@/hooks/usePermission";
import { compareStrings } from "@/utils/localeFormat";
import type { SshKey, Identity } from "@/types";
import { SheetActionRow, type SheetAction } from "./SheetActionRow";
import { identityTarget, keyTarget } from "@/services/previewGuard";
import { previewGuarded } from "./previewGuardedActions";

type Mode = "menu" | "confirm-delete" | "move-folder";

const Row = ({ it }: { it: SheetAction }) => <SheetActionRow attr="keychain-action" it={it} />;

/** Rows left out from the edit screen's ⋮: it is the editor, and its form autosaves its own folder. */
const EDITOR_HIDDEN = new Set(["edit", "move-folder"]);

type Props =
  | { kind: "key"; item: SshKey; onClose: () => void; fromEditor?: boolean }
  | { kind: "identity"; item: Identity; onClose: () => void; fromEditor?: boolean };

function toast(message: string, severity: "success" | "error") {
  useNotificationStore.getState().addToast({ source: APP_SOURCE, type: "toast", message, severity, duration: 2000 });
}

export default function KeychainItemActionsSheet(props: Props) {
  const { kind, item, onClose, fromEditor = false } = props;
  const { t } = useTranslation();
  const deleteKey = useKeyStore((s) => s.deleteKey);
  const deleteIdentity = useIdentityStore((s) => s.deleteIdentity);
  const moveObjectsToFolder = useFolderStore((s) => s.moveObjectsToFolder);
  const push = useMobileNavStore((s) => s.push);
  const allFolders = useAllFolders();
  const can = usePermissions();
  const [mode, setMode] = useState<Mode>("menu");
  const vaultId = item.vault_id ?? "personal";
  const canEdit = can(kind === "key" ? "EDIT_KEYS" : "EDIT_IDENTITIES", vaultId, item.id);

  const name = item.name ?? (kind === "key" ? t("mobile.sheets.keychainActions.unnamedKey") : (item as Identity).username);

  if (mode === "move-folder") {
    return (
      <MoveToFolderSheet
        targets={buildMoveTargets(allFolders, "keychain", vaultId, compareStrings)}
        currentFolderId={item.folder_id ?? null}
        onPick={async (folderId) => { await moveObjectsToFolder([item.id], kind === "key" ? "key" : "identity", folderId); if (kind === "key") await useKeyStore.getState().loadKeys(); else await useIdentityStore.getState().loadIdentities(); }}
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

  const items: SheetAction[] = previewGuarded([
    ...(canEdit ? [{ icon: "lucide:pencil", label: t("common.action.edit"), slug: "edit", onTap: () => {
      push(kind === "key" ? { kind: "key-edit", keyId: item.id } : { kind: "identity-edit", identityId: item.id });
      onClose();
    } }] : []),
    kind === "key"
      ? { icon: "lucide:clipboard-copy", label: t("mobile.sheets.keychainActions.copyPublicKey"), slug: "copy-public-key", reads: true, onTap: async () => {
          const pub = await ensurePublicKey(item as SshKey);
          if (pub) { await writeClipboard(pub); toast(t("mobile.sheets.keychainActions.copiedPublicKey"), "success"); }
          else { toast(t("mobile.sheets.keychainActions.noPublicKeyStored"), "error"); }
          onClose();
        } }
      : { icon: "lucide:clipboard-copy", label: t("mobile.sheets.keychainActions.copyUsername"), slug: "copy-username", reads: true, onTap: async () => {
          await writeClipboard((item as Identity).username);
          toast(t("mobile.sheets.keychainActions.copiedUsername"), "success");
          onClose();
        } },
    // The public line only: publicKeyShareText refuses anything else, the private half included.
    ...(kind === "key" && canShare() ? [{ icon: "lucide:share-2", label: t("mobile.share.publicKey"), slug: "share-public-key", reads: true, onTap: async () => {
      const pub = publicKeyShareText(await ensurePublicKey(item as SshKey).catch(() => null));
      onClose();
      if (!pub) toast(t("mobile.sheets.keychainActions.noPublicKeyStored"), "error");
      else if (!shareText(pub, name)) toast(t("mobile.share.failed"), "error");
    } }] : []),
    ...(canEdit ? [
      { icon: "lucide:folder-tree", label: t("mobile.sheets.shared.moveToFolder"), slug: "move-folder", onTap: () => setMode("move-folder") },
      { icon: "lucide:trash-2", label: t("common.action.delete"), danger: true, slug: "delete", onTap: () => setMode("confirm-delete") },
    ] : []),
  ], (kind === "key" ? keyTarget : identityTarget)(item.id), onClose);

  return (
    <BottomSheet title={name} onClose={onClose}>
      {items.filter((it) => !fromEditor || !EDITOR_HIDDEN.has(it.slug ?? "")).map((it) => <Row key={it.slug} it={it} />)}
    </BottomSheet>
  );
}
