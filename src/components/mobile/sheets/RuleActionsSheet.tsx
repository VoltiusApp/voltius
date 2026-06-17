import { useState } from "react";
import { Icon } from "@iconify/react";
import BottomSheet from "./BottomSheet";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useAllFolders } from "@/hooks/useAllFolders";
import { buildMoveTargets } from "@/components/mobile/folders/mobileFolderCore";
import MoveToFolderSheet from "./MoveToFolderSheet";
import type { PortForwardingRule, PortForwardingRuleFormData } from "@/types";

type Mode = "menu" | "confirm-delete" | "move" | "copy" | "move-folder";

type Item = { icon: string; label: string; slug: string; danger?: boolean; onTap: () => void };

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
  const deleteRule = usePortForwardingStore((s) => s.deleteRule);
  const updateRule = usePortForwardingStore((s) => s.updateRule);
  const createRule = usePortForwardingStore((s) => s.createRule);
  const allRules = usePortForwardingStore((s) => s.rules);
  const teamRules = usePortForwardingStore((s) => s.teamRules);
  const vaults = useVaultStore((s) => s.vaults);
  const [mode, setMode] = useState<Mode>("menu");

  const allFolders = useAllFolders();
  const otherVaults = vaults.filter((v) => v.id !== rule.vault_id);

  const Row = ({ it }: { it: Item }) => (
    <button
      data-rule-action={it.slug}
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
      <BottomSheet title="Delete rule?" onClose={onClose}>
        <div className="px-3 pt-1 pb-2 text-sm text-(--t-text-dim)">
          Permanently delete <span className="text-(--t-text-primary) font-medium">{rule.name}</span>? This can&rsquo;t be undone.
        </div>
        <Row it={{ icon: "lucide:trash-2", label: "Delete", slug: "delete", danger: true, onTap: () => { void deleteRule(rule.id); onClose(); } }} />
        <Row it={{ icon: "lucide:x", label: "Cancel", slug: "cancel", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  if (mode === "move-folder") {
    return (
      <MoveToFolderSheet
        targets={buildMoveTargets(allFolders, "port_forwarding")}
        currentFolderId={rule.folder_id ?? null}
        onPick={(folderId) => { void updateRule(rule.id, { ...fields(rule, rule.vault_id), folder_id: folderId ?? undefined }); }}
        onClose={onClose}
      />
    );
  }

  if (mode === "move") {
    return (
      <BottomSheet title="Move to vault" onClose={onClose}>
        {otherVaults.map((v) => (
          <Row key={v.id} it={{ icon: "lucide:vault", label: v.name, slug: "move-target", onTap: () => {
            void updateRule(rule.id, fields(rule, v.id));
            onClose();
          } }} />
        ))}
        <Row it={{ icon: "lucide:arrow-left", label: "Back", slug: "back", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  if (mode === "copy") {
    const allKnown = [...allRules, ...Object.values(teamRules).flat()];
    return (
      <BottomSheet title="Copy to vault" onClose={onClose}>
        {otherVaults.map((v) => (
          <Row key={v.id} it={{ icon: "lucide:copy", label: v.name, slug: "copy-target", onTap: () => {
            const dup = allKnown.some((r) => r.vault_id === v.id && r.name === rule.name);
            void createRule({ ...fields(rule, v.id), name: dup ? `${rule.name} (copy)` : rule.name });
            onClose();
          } }} />
        ))}
        <Row it={{ icon: "lucide:arrow-left", label: "Back", slug: "back", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  const items: Item[] = [
    { icon: "lucide:pencil", label: "Edit", slug: "edit", onTap: () => { onEdit(rule); onClose(); } },
    { icon: "lucide:folder-tree", label: "Move to folder", slug: "move-folder", onTap: () => setMode("move-folder") },
    ...(otherVaults.length > 0 ? [{ icon: "lucide:folder-input", label: "Move to vault", slug: "move", onTap: () => setMode("move") }] : []),
    ...(otherVaults.length > 0 ? [{ icon: "lucide:copy", label: "Copy to vault", slug: "copy", onTap: () => setMode("copy") }] : []),
    { icon: "lucide:trash-2", label: "Delete", slug: "delete", danger: true, onTap: () => setMode("confirm-delete") },
  ];

  return (
    <BottomSheet title={rule.name} onClose={onClose}>
      {items.map((it) => <Row key={it.slug} it={it} />)}
    </BottomSheet>
  );
}
