import { createRuleSet, getRuleSet, putRuleSet, type TeamObjectType } from "@/services/teamObjects";
import { findTeamItem, saveTeamVaultObject } from "@/services/teamObjectPersistence";
import { isFolderType, isSynced, setOfParent, syncedSubtree } from "@/services/ruleSetPointers";
import type { RuleEntry } from "@/services/permissions";
import { teamAccessEntries, type TeamAccessEntries } from "@/stores/teamObjectAccessStore";

export type RuleEdit = (entries: RuleEntry[]) => RuleEntry[];

const CONFLICT_RETRIES = 3;
const isConflict = (e: unknown) => (e as { status?: number } | null)?.status === 409;

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

export async function saveObjectRules(target: RuleTarget, edit: RuleEdit): Promise<RuleEntry[] | null> {
  for (let attempt = 0; ; attempt++) {
    const all = teamAccessEntries(target.teamId);
    const current = all[target.objectId];
    if (!current) return null;
    const setId = current.ruleSetId;
    const base = setId === null ? { entries: [], updatedAt: null } : await getRuleSet(target.teamId, setId);
    const entries = edit(base.entries);
    if (setId === null || isSynced(all, target.objectId) || sharedBeyond(all, target, setId)) {
      await repoint(target, await createRuleSet(target.teamId, entries));
      return entries;
    }
    try {
      await putRuleSet(target.teamId, setId, entries, base.updatedAt);
      return entries;
    } catch (e) {
      if (!isConflict(e) || attempt >= CONFLICT_RETRIES) throw e;
    }
  }
}

export async function syncWithFolder(target: RuleTarget): Promise<void> {
  const all = teamAccessEntries(target.teamId);
  const current = all[target.objectId];
  if (current) await repoint(target, setOfParent(all, current.parentId));
}
