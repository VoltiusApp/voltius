import type { Connection, PortForwardingRule, PortForwardingRuleFormData } from "@/types";
import type { VaultClipboardKind } from "@/stores/vaultClipboardStore";
import { ruleToForm } from "@/utils/portForwardingForm";
import { nameIsFree } from "@/utils/cloneName";
import type { ClipboardHalf } from "./types";

export interface PortForwardingClipboardDeps {
  rules: PortForwardingRule[];
  connections: Connection[];
  getRulesInFolderTree: (folderId: string) => PortForwardingRule[];
  vaultForFolder: (folderId: string | null) => string | null;
  moveRuleFolder: (id: string, folderId: string | null) => Promise<unknown>;
  updateRule: (id: string, form: PortForwardingRuleFormData) => Promise<unknown>;
  duplicateRuleInto: (
    rule: PortForwardingRule,
    folderId: string | null,
    opts: { vaultId?: string; keepName: boolean },
  ) => Promise<{ id: string }>;
  deleteRule: (id: string) => Promise<unknown>;
}

export function portForwardingClipboardHalf(deps: PortForwardingClipboardDeps): ClipboardHalf {
  return {
    folderContentKinds: (folderId): VaultClipboardKind[] =>
      deps.getRulesInFolderTree(folderId).length > 0 ? ["port_forward"] : [],
    // A migrated rule keeps pointing at the hosts it tunnels through, which this
    // path does not move. Unlike Hosts and Keychain this cannot be expressed as a
    // missing permission — a rule and a connection share EDIT_CONNECTIONS, so
    // anyone allowed to paste the rule is already allowed the connection.
    danglingKinds: (items, folderIds, destination): VaultClipboardKind[] => {
      const moved = [
        ...items.map((i) => deps.rules.find((r) => r.id === i.id)).filter((r) => !!r),
        ...folderIds.flatMap((id) => deps.getRulesInFolderTree(id)),
      ];
      const linked = moved
        .flatMap((r) => r.connection_ids)
        .map((id) => deps.connections.find((c) => c.id === id))
        .filter((c) => !!c);
      return linked.some((c) => (c.vault_id ?? "personal") !== destination) ? ["connection"] : [];
    },
    // A same-vault move only rewrites folder_id; a cross-vault one has to go through
    // updateRule so the object actually changes vault, otherwise it would keep a
    // stale vault_id alongside its new folder's.
    moveItems: async (ids, folderId, vaultId) => {
      for (const id of ids) {
        const rule = deps.rules.find((r) => r.id === id);
        if (!rule) continue;
        if (vaultId === null || (rule.vault_id ?? "personal") === vaultId) {
          await deps.moveRuleFolder(id, folderId);
          continue;
        }
        await deps.updateRule(id, ruleToForm(rule, { folder_id: folderId ?? undefined, vault_id: vaultId }));
      }
    },
    duplicateItems: async (ids, folderId) => {
      const targetVault = deps.vaultForFolder(folderId) ?? undefined;
      const created: string[] = [];
      for (const id of ids) {
        const rule = deps.rules.find((r) => r.id === id);
        if (!rule) continue;
        created.push((await deps.duplicateRuleInto(rule, folderId, {
          vaultId: targetVault,
          keepName: nameIsFree(deps.rules, rule.name, targetVault ?? rule.vault_id ?? "personal", folderId),
        })).id);
      }
      return created;
    },
    deleteItems: async (ids) => { for (const id of ids) await deps.deleteRule(id); },
  };
}
