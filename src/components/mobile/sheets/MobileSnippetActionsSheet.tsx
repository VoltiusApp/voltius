import { useState } from "react";
import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useAllSnippets } from "@/hooks/useAllSnippets";
import { useOtherVaultOptions } from "@/hooks/useVaultOptions";
import { usePermissions } from "@/hooks/usePermission";
import { useEffectivePinned } from "@/hooks/useEffectivePinned";
import { snippetToForm } from "@/utils/snippetForm";
import { copyingRulesOf } from "@/services/ruleSetIntent";
import { useAllSnippetFolders } from "@/hooks/useAllSnippetFolders";
import { buildMoveTargets } from "@/components/mobile/folders/mobileFolderCore";
import { compareStrings } from "@/utils/localeFormat";
import { canShare, shareText, snippetShareText, MAX_SHARE_TEXT } from "@/services/share";
import { appToast } from "@/services/appToast";
import MoveToFolderSheet from "./MoveToFolderSheet";
import VaultTransferSheet from "./VaultTransferSheet";
import { SheetActionRow, type SheetAction } from "./SheetActionRow";
import { snippetTarget } from "@/services/previewGuard";
import { previewGuarded } from "./previewGuardedActions";

type Mode = "menu" | "confirm-delete" | "move" | "copy" | "move-folder";

const Row = ({ it }: { it: SheetAction }) => <SheetActionRow attr="snippet-action" it={it} />;

export default function MobileSnippetActionsSheet({ snippetId }: { snippetId: string }) {
  const { t } = useTranslation();
  const closeSheet = useMobileNavStore((s) => s.closeSheet);
  const push = useMobileNavStore((s) => s.push);
  const snippet = useAllSnippets().find((x) => x.id === snippetId);
  const createSnippet = useSnippetStore((s) => s.createSnippet);
  const updateSnippet = useSnippetStore((s) => s.updateSnippet);
  const deleteSnippet = useSnippetStore((s) => s.deleteSnippet);
  const pinSnippet = useSnippetStore((s) => s.pinSnippet);
  const allSnippetFolders = useAllSnippetFolders();
  // useEffectivePinned is a hook — must be called unconditionally BEFORE any early return
  const pinned = useEffectivePinned(snippet ?? ({} as never), "snippet");
  const vaultTargets = useOtherVaultOptions(snippet?.vault_id);
  const can = usePermissions();
  const [mode, setMode] = useState<Mode>("menu");

  if (!snippet) return null;
  const currentVaultId = snippet.vault_id ?? "personal";
  const canEdit = can("EDIT_SNIPPETS", currentVaultId, snippet.id);
  const shareable = canShare() ? snippetShareText(snippet) : null;

  if (mode === "confirm-delete") {
    return (
      <BottomSheet title={t("mobile.sheets.snippetActions.deleteTitle")} onClose={closeSheet}>
        <div className="px-3 pt-1 pb-2 text-sm text-(--t-text-dim)">
          {t("mobile.sheets.shared.confirmDeleteBody", { name: snippet.name })}
        </div>
        <Row it={{ icon: "lucide:trash-2", label: t("common.action.delete"), danger: true, slug: "delete-confirm", onTap: () => { void deleteSnippet(snippetId); closeSheet(); } }} />
        <Row it={{ icon: "lucide:x", label: t("common.action.cancel"), slug: "cancel", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  if (mode === "move-folder") {
    return (
      <MoveToFolderSheet
        targets={buildMoveTargets(allSnippetFolders, "snippet", currentVaultId, compareStrings)}
        currentFolderId={snippet.folder_id ?? null}
        onPick={(folderId) => updateSnippet(snippetId, { ...snippetToForm(snippet), folder_id: folderId ?? undefined })}
        onClose={closeSheet}
      />
    );
  }

  if (mode === "move" || mode === "copy") {
    return (
      <VaultTransferSheet tab="snippets" ids={[snippetId]} mode={mode === "copy" ? "copy" : "cut"} targets={vaultTargets}
        attr="snippet-action" onBack={() => setMode("menu")} onClose={closeSheet} />
    );
  }

  const items: SheetAction[] = previewGuarded([
    ...(canEdit ? [
      { icon: "lucide:pencil", label: t("common.action.edit"), slug: "edit", onTap: () => { closeSheet(); push({ kind: "snippet-edit", snippetId }); } },
      { icon: "lucide:copy", label: t("mobile.sheets.shared.duplicate"), slug: "duplicate", onTap: () => {
          void createSnippet(copyingRulesOf({ ...snippetToForm(snippet), name: `${snippet.name} (copy)`, favorite: false }, snippet.id));
          closeSheet();
        } },
    ] : []),
    ...(shareable ? [{ icon: "lucide:share-2", label: t("mobile.share.action"), slug: "share", reads: true, onTap: () => {
      closeSheet();
      if (!shareText(shareable, snippet.name)) appToast("error", t(shareable.length > MAX_SHARE_TEXT ? "mobile.share.tooLong" : "mobile.share.failed"));
    } }] : []),
    { icon: pinned ? "lucide:pin-off" : "lucide:pin", label: pinned ? t("mobile.sheets.shared.unpin") : t("mobile.sheets.shared.pin"), slug: pinned ? "unpin" : "pin", onTap: () => { void pinSnippet(snippetId, !pinned); closeSheet(); } },
    ...(canEdit && vaultTargets.length > 0 ? [{ icon: "lucide:folder-input", label: t("mobile.sheets.shared.moveToVault"), slug: "move-to-vault", onTap: () => setMode("move") }] : []),
    ...(vaultTargets.length > 0 ? [{ icon: "lucide:copy-plus", label: t("mobile.sheets.shared.copyToVault"), slug: "copy-to-vault", onTap: () => setMode("copy") }] : []),
    ...(canEdit ? [
      { icon: "lucide:folder-tree", label: t("mobile.sheets.shared.moveToFolder"), slug: "move-to-folder", onTap: () => setMode("move-folder") },
      { icon: "lucide:trash-2", label: t("common.action.delete"), danger: true, slug: "delete", onTap: () => setMode("confirm-delete") },
    ] : []),
  ], snippetTarget(snippetId));

  return (
    <BottomSheet title={snippet.name} onClose={closeSheet}>
      {items.map((it) => <Row key={it.slug ?? it.label} it={it} />)}
    </BottomSheet>
  );
}
