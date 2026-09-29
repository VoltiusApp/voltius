import { createRuleSet, putRuleSet, type TeamObjectType } from "@/services/teamObjects";
import { findTeamItem, saveTeamVaultObject } from "@/services/teamObjectPersistence";
import { isSynced, setOfParent } from "@/services/ruleSetPointers";
import type { RuleEntry } from "@/services/permissions";
import { teamAccessEntries } from "@/stores/teamObjectAccessStore";

export interface RuleTarget {
  teamId: string;
  objectId: string;
  type: TeamObjectType;
}

async function repoint(target: RuleTarget, ruleSetId: string | null): Promise<void> {
  const item = await findTeamItem(target.teamId, target.type, target.objectId);
  if (item) await saveTeamVaultObject(target.teamId, target.type, item, { ruleSetId });
}

export async function saveObjectRules(target: RuleTarget, entries: RuleEntry[]): Promise<void> {
  const all = teamAccessEntries(target.teamId);
  const current = all[target.objectId];
  if (!current) return;
  if (current.ruleSetId !== null && !isSynced(all, target.objectId)) {
    await putRuleSet(target.teamId, current.ruleSetId, entries);
    return;
  }
  await repoint(target, await createRuleSet(target.teamId, entries));
}

export async function syncWithFolder(target: RuleTarget): Promise<void> {
  const all = teamAccessEntries(target.teamId);
  const current = all[target.objectId];
  if (current) await repoint(target, setOfParent(all, current.parentId));
}
