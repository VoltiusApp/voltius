import i18n from "@/i18n";
import { copyRuleSet, deleteTeamObject, upsertTeamObject, type TeamObjectType } from "@/services/teamObjects";
import { encodeObjectMetadata } from "@/services/teamObjectEnvelope";
import { parentIdOf } from "@/services/teamObjectAccess";
import { isFolderType, isSynced, pointerForSave, syncedSubtree, type Pointer } from "@/services/ruleSetPointers";
import { PERM_BITS, type Permission } from "@/services/permissions";
import {
  ruleSetsSupported, teamAccessEntries, useTeamObjectAccessStore, type TeamAccessEntries,
} from "@/stores/teamObjectAccessStore";

export interface PersistableTeamObject {
  id: string;
  name?: string;
  folder_id?: string;
}

export interface SaveTeamObjectOptions {
  ruleSetId?: string | null;
  rulesFrom?: string;
  cascade?: boolean;
}

export class RuleSetMoveCancelled extends Error {
  constructor() {
    super(i18n.t("shared.permissions.moveWarning.cancelled"));
  }
}

export const unlessMoveCancelled = (report: (message: string) => void) => (err: unknown): void => {
  if (!(err instanceof RuleSetMoveCancelled)) report(String(err));
};

type MoveConfirmer = (teamId: string, from: string | null, to: string | null) => Promise<boolean>;
let confirmMove: MoveConfirmer = async () => true;

export function setRuleSetMoveConfirmer(fn: MoveConfirmer): void {
  confirmMove = fn;
}

type Can = (permission: Permission, vaultId: string, objectId?: string) => boolean;

const teamLevelMask = (can: Can, teamId: string): number =>
  (Object.keys(PERM_BITS) as Permission[]).reduce((mask, p) => (can(p, teamId) ? mask | PERM_BITS[p] : mask), PERM_BITS.VIEW);

async function copiedSetFor(teamId: string, sourceId: string, entries: TeamAccessEntries): Promise<string | undefined> {
  const source = entries[sourceId];
  if (!source || source.ruleSetId === null || isSynced(entries, sourceId)) return undefined;
  return copyRuleSet(teamId, source.ruleSetId);
}

async function decidePointer(
  teamId: string, item: PersistableTeamObject, opts: SaveTeamObjectOptions, entries: TeamAccessEntries, can: Can,
): Promise<Pointer> {
  if (opts.ruleSetId !== undefined) return opts.ruleSetId;
  const current = entries[item.id];
  if (!current && opts.rulesFrom) {
    const copied = await copiedSetFor(teamId, opts.rulesFrom, entries);
    if (copied !== undefined) return copied;
  }
  const pointer = pointerForSave({
    entries,
    objectId: item.id,
    nextParentId: parentIdOf(item),
    canManageAtRoot: can("MANAGE_ROLES", teamId) || can("ADMINISTRATOR", teamId),
  });
  if (current && pointer !== undefined && !(await confirmMove(teamId, current.ruleSetId, pointer))) {
    throw new RuleSetMoveCancelled();
  }
  return pointer;
}

async function upsertWithPointer(
  teamId: string, objectType: TeamObjectType, item: PersistableTeamObject, pointer: Pointer,
): Promise<Pointer> {
  // name and folder_id are null: every field lives in the encrypted metadata.
  const body = { object_id: item.id, object_type: objectType, name: null, folder_id: null, metadata: await encodeObjectMetadata(teamId, item) };
  try {
    await upsertTeamObject(teamId, { ...body, rule_set_id: pointer });
    return pointer;
  } catch (e) {
    if ((e as { status?: number }).status !== 409 || pointer === undefined) throw e;
    await upsertTeamObject(teamId, body);
    return undefined;
  }
}

function recordSaved(
  teamId: string, objectType: TeamObjectType, item: PersistableTeamObject, applied: Pointer,
  entries: TeamAccessEntries, can: Can,
): void {
  const previous = entries[item.id];
  const parentId = parentIdOf(item);
  const ruleSetId = applied !== undefined ? applied : previous?.ruleSetId ?? null;
  const parent = parentId ? entries[parentId] : undefined;
  const myPermissions = parent && parent.ruleSetId === ruleSetId
    ? parent.myPermissions
    : previous?.myPermissions ?? teamLevelMask(can, teamId);
  useTeamObjectAccessStore.getState().upsert(teamId, item.id, { type: objectType, ruleSetId, myPermissions, parentId, deleted: false });
}

export async function findTeamItem(teamId: string, type: TeamObjectType, id: string): Promise<PersistableTeamObject | undefined> {
  const lists: Record<TeamObjectType, () => Promise<PersistableTeamObject[] | undefined>> = {
    connection: async () => (await import("@/stores/connectionStore")).useConnectionStore.getState().teamConnections[teamId],
    identity: async () => (await import("@/stores/identityStore")).useIdentityStore.getState().teamIdentities[teamId],
    key: async () => (await import("@/stores/keyStore")).useKeyStore.getState().teamKeys[teamId],
    folder: async () => (await import("@/stores/folderStore")).useFolderStore.getState().teamFolders[teamId],
    snippet: async () => (await import("@/stores/snippetStore")).useSnippetStore.getState().teamSnippets[teamId],
    snippet_folder: async () => (await import("@/stores/snippetFolderStore")).useSnippetFolderStore.getState().teamSnippetFolders[teamId],
    port_forwarding_rule: async () => (await import("@/stores/portForwardingStore")).usePortForwardingStore.getState().teamRules[teamId],
  };
  return (await lists[type]())?.find((x) => x.id === id);
}

export async function saveTeamVaultObject<T extends PersistableTeamObject>(
  teamId: string,
  objectType: TeamObjectType,
  item: T,
  opts: SaveTeamObjectOptions = {},
): Promise<void> {
  if (!ruleSetsSupported(teamId)) {
    await upsertWithPointer(teamId, objectType, item, undefined);
    return;
  }
  const entries = teamAccessEntries(teamId);
  const can = await (await import("@/services/permissionsFromStores")).canFromStoresAsync();
  const pointer = await decidePointer(teamId, item, opts, entries, can);
  const applied = await upsertWithPointer(teamId, objectType, item, pointer);
  recordSaved(teamId, objectType, item, applied, entries, can);
  if (applied === undefined || opts.cascade === false || !isFolderType(objectType) || !entries[item.id]) return;
  for (const id of syncedSubtree(entries, item.id)) {
    const entry = entries[id];
    const child = await findTeamItem(teamId, entry.type, id);
    if (child) await saveTeamVaultObject(teamId, entry.type, child, { ruleSetId: applied, cascade: false });
  }
}

export async function removeTeamVaultObject(teamId: string, objectId: string): Promise<void> {
  await deleteTeamObject(teamId, objectId);
  const entry = teamAccessEntries(teamId)[objectId];
  if (entry) useTeamObjectAccessStore.getState().upsert(teamId, objectId, { ...entry, deleted: true });
}
