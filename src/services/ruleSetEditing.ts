import { createRuleSet, putRuleSet, type TeamObjectType } from "@/services/teamObjects";
import { findTeamItem, saveTeamVaultObject } from "@/services/teamObjectPersistence";
import { isFolderType, isSynced, setOfParent, syncedSubtree } from "@/services/ruleSetPointers";
import type { RuleEntry } from "@/services/permissions";
import { teamAccessEntries, type TeamAccessEntries } from "@/stores/teamObjectAccessStore";

export interface RuleTarget {
  teamId: string;
  objectId: string;
  type: TeamObjectType;
}

async function repoint(target: RuleTarget, ruleSetId: string | null): Promise<void> {
  const item = await findTeamItem(target.teamId, target.type, target.objectId);
  if (item) await saveTeamVaultObject(target.teamId, target.type, item, { ruleSetId });
}

function sharedBeyond(all: TeamAccessEntries, target: RuleTarget, ruleSetId: string): boolean {
  const own = new Set([target.objectId, ...(isFolderType(target.type) ? syncedSubtree(all, target.objectId) : [])]);
  return Object.entries(all).some(([id, entry]) => !entry.deleted && entry.ruleSetId === ruleSetId && !own.has(id));
}

export async function saveObjectRules(target: RuleTarget, entries: RuleEntry[]): Promise<void> {
  const all = teamAccessEntries(target.teamId);
  const current = all[target.objectId];
  if (!current) return;
  if (current.ruleSetId !== null && !isSynced(all, target.objectId) && !sharedBeyond(all, target, current.ruleSetId)) {
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
