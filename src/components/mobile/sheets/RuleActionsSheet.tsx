import { useState } from "react";
import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useOtherVaultOptions } from "@/hooks/useVaultOptions";
import { usePermissions } from "@/hooks/usePermission";
import { useAllFolders } from "@/hooks/useAllFolders";
import { buildMoveTargets } from "@/components/mobile/folders/mobileFolderCore";
import { compareStrings } from "@/utils/localeFormat";
import MoveToFolderSheet from "./MoveToFolderSheet";
import type { PortForwardingRule, PortForwardingRuleFormData } from "@/types";
import { SheetActionRow, type SheetAction } from "./SheetActionRow";
import VaultTransferSheet from "./VaultTransferSheet";

type Mode = "menu" | "confirm-delete" | "move" | "copy" | "move-folder";

const Row = ({ it }: { it: SheetAction }) => <SheetActionRow attr="rule-action" it={it} />;

function fields(rule: PortForwardingRule, vaultId: string): PortForwardingRuleFormData {
  return {
    name: rule.name,
    local_port: rule.local_port,
    remote_port: rule.remote_port,
    remote_host: rule.remote_host,
    tunnel_type: rule.tunnel_type,
    bind_host: rule.bind_host,
    target_host: rule.target_host,
    description: rule.description,
    connection_ids: rule.connection_ids,
    folder_id: rule.folder_id,
    vault_id: vaultId,
  };
}

export default function RuleActionsSheet({ rule, onEdit, onClose }: {
  rule: PortForwardingRule;
  onEdit: (rule: PortForwardingRule) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deleteRule = usePortForwardingStore((s) => s.deleteRule);
  const updateRule = usePortForwardingStore((s) => s.updateRule);
  const otherVaults = useOtherVaultOptions(rule.vault_id, { includeUnlinkedTeams: false });
  const can = usePermissions();
  const [mode, setMode] = useState<Mode>("menu");

  const allFolders = useAllFolders();
  const vaultId = rule.vault_id ?? "personal";
  const canEdit = can("EDIT_CONNECTIONS", vaultId, rule.id);

  if (mode === "confirm-delete") {
    return (
      <BottomSheet title={t("mobile.sheets.ruleActions.deleteTitle")} onClose={onClose}>
        <div className="px-3 pt-1 pb-2 text-sm text-(--t-text-dim)">
          {t("mobile.sheets.shared.confirmDeleteBody", { name: rule.name })}
        </div>
        <Row it={{ icon: "lucide:trash-2", label: t("common.action.delete"), slug: "delete", danger: true, onTap: () => { void deleteRule(rule.id); onClose(); } }} />
        <Row it={{ icon: "lucide:x", label: t("common.action.cancel"), slug: "cancel", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  if (mode === "move-folder") {
    return (
      <MoveToFolderSheet
        targets={buildMoveTargets(allFolders, "port_forwarding", vaultId, compareStrings)}
        currentFolderId={rule.folder_id ?? null}
        onPick={(folderId) => updateRule(rule.id, { ...fields(rule, rule.vault_id), folder_id: folderId ?? undefined })}
        onClose={onClose}
      />
    );
  }

  if (mode === "move" || mode === "copy") {
    return (
      <VaultTransferSheet tab="port-forwarding" ids={[rule.id]} mode={mode === "copy" ? "copy" : "cut"} targets={otherVaults}
        attr="rule-action" onBack={() => setMode("menu")} onClose={onClose} />
    );
  }

  const items: SheetAction[] = [
    ...(canEdit ? [
      { icon: "lucide:pencil", label: t("common.action.edit"), slug: "edit", onTap: () => { onEdit(rule); onClose(); } },
      { icon: "lucide:folder-tree", label: t("mobile.sheets.shared.moveToFolder"), slug: "move-folder", onTap: () => setMode("move-folder") },
    ] : []),
    ...(canEdit && otherVaults.length > 0 ? [{ icon: "lucide:folder-input", label: t("mobile.sheets.shared.moveToVault"), slug: "move", onTap: () => setMode("move") }] : []),
    ...(otherVaults.length > 0 ? [{ icon: "lucide:copy", label: t("mobile.sheets.shared.copyToVault"), slug: "copy", onTap: () => setMode("copy") }] : []),
    ...(canEdit ? [{ icon: "lucide:trash-2", label: t("common.action.delete"), slug: "delete", danger: true, onTap: () => setMode("confirm-delete") }] : []),
  ];

  return (
    <BottomSheet title={rule.name} onClose={onClose}>
      {items.map((it) => <Row key={it.slug} it={it} />)}
    </BottomSheet>
  );
}
