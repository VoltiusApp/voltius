import { isEncryptedEnvelope, encodeObjectMetadata } from "@/services/teamObjectEnvelope";
import { reencryptTeamObjects } from "@/services/teamObjects";
import { resolveCan, type Permission } from "@/services/permissions";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { getMyUserId } from "@/services/teamService";
import type { TeamObjectRecord } from "@/services/teamObjects";

/** Server-side truth is `edit_permission_for_str` in routes/team_objects.rs. */
const EDIT_PERMISSION: Record<string, Permission> = {
  connection: "EDIT_CONNECTIONS",
  port_forwarding_rule: "EDIT_CONNECTIONS",
  snippet: "EDIT_SNIPPETS",
  identity: "EDIT_IDENTITIES",
  key: "EDIT_KEYS",
  folder: "EDIT_FOLDERS",
  snippet_folder: "EDIT_FOLDERS",
};

/** Rows still holding plaintext metadata, ignoring what the caller may edit. */
export function countUnencryptedObjects(objects: TeamObjectRecord[]): number {
  return objects.filter((o) => !o.deleted_at && !isEncryptedEnvelope(o.metadata)).length;
}

const BATCH_SIZE = 50;

/**
 * One-time migration of rows written before #229. Runs in the background after
 * a team loads; a failure just leaves the rest for the next connect, since the
 * work item is recomputed from "which rows are still v1" each time.
 *
 * Writes are permission-gated per object type server-side, so the pass filters
 * to the types this member may edit. A team migrates as its privileged members
 * connect, and one whose only such members never reconnect stays plaintext —
 * which is what `countUnencryptedObjects` (and the count this pass records on
 * `useTeamVaultStateStore`) surfaces for issue #229's task 9.
 *
 * Deliberately does NOT go through saveTeamVaultObject: that path stamps the
 * audit log, and re-encryption is not an edit.
 */
export async function runReencryptionPass(
  teamId: string,
  objects: TeamObjectRecord[],
): Promise<number> {
  const totalUnencrypted = countUnencryptedObjects(objects);
  let done = 0;

  try {
    // getMyUserId() reads the JWT via the keychain bridge and can reject (no
    // session, not running under Tauri); best-effort like the rest of this
    // background pass — an empty id just resolves every permission to false.
    let myUserId = "";
    try {
      myUserId = (await getMyUserId()) ?? "";
    } catch {
      // ignore — resolveCan treats a blank id as "no access"
    }

    const snapshot = {
      myUserId,
      teams: useTeamStore.getState().teams,
      membersByTeam: useTeamStore.getState().membersByTeam,
      rolesByTeam: useTeamStore.getState().rolesByTeam,
      vaults: useVaultStore.getState().vaults,
    };

    const pending = objects.filter((o) => {
      if (o.deleted_at || isEncryptedEnvelope(o.metadata)) return false;
      const permission = EDIT_PERMISSION[o.object_type];
      return permission !== undefined && resolveCan(snapshot, permission, teamId);
    });

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const slice = pending.slice(i, i + BATCH_SIZE);
      const items = await Promise.all(
        slice.map(async (o) => ({
          object_id: o.object_id,
          metadata: await encodeObjectMetadata(teamId, o.metadata as object),
        })),
      );
      await reencryptTeamObjects(teamId, items);
      done += items.length;
    }

    return done;
  } finally {
    // Every successfully re-encrypted row leaves the plaintext pool, whether
    // or not this member could reach every row (e.g. a permission-skipped
    // "key" object stays counted). Recorded even on zero/failure so a team
    // that finishes migrating — or one with nothing to do — clears its own
    // warning, and a partial failure still reflects whatever progress was made.
    useTeamVaultStateStore.getState().setUnencryptedCount(teamId, totalUnencrypted - done);
  }
}
