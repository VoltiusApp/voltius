import { encodeObjectMetadata } from "@/services/teamObjectEnvelope";
import { acceptsPlaintextRows, isTrustedPlaintextRow } from "@/services/teamObjectRows";
import { reencryptTeamObjects } from "@/services/teamObjects";
import { buildEditPermissionSnapshot, canEditObjectType } from "@/services/teamObjectEditPermission";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import type { TeamObjectRecord } from "@/services/teamObjects";

const BATCH_SIZE = 50;

/**
 * One-time migration of rows written before #229. Runs in the background after
 * a team loads; a failure just leaves the rest for the next connect, since the
 * work item is recomputed from "which rows are still v1" each time.
 *
 * Writes are permission-gated per object type server-side, so the pass filters
 * to the types this member may edit. A team migrates as its privileged members
 * connect, and one whose only such members never reconnect stays plaintext —
 * which is what the count this pass records on `useTeamVaultStateStore`
 * surfaces for issue #229's task 9.
 *
 * Deliberately does NOT go through saveTeamVaultObject: that path stamps the
 * audit log, and re-encryption is not an edit.
 */
const _passInFlight = new Map<string, Promise<number>>();

export function runReencryptionPass(
  teamId: string,
  objects: TeamObjectRecord[],
): Promise<number> {
  // fetchTeamData serialises per team, but this pass is launched fire-and-forget
  // so it escapes that queue: two loads in quick succession would otherwise both
  // encrypt and PUT the same rows, doubling the writes and the SSE fan-out.
  const existing = _passInFlight.get(teamId);
  if (existing) return existing;

  const run = _runReencryptionPass(teamId, objects);
  _passInFlight.set(teamId, run);
  run.finally(() => _passInFlight.delete(teamId)).catch(() => {});
  return run;
}

async function _runReencryptionPass(
  teamId: string,
  objects: TeamObjectRecord[],
): Promise<number> {
  const allowPlaintext = acceptsPlaintextRows(teamId);
  const migratable = objects.filter((o) => !o.deleted_at && isTrustedPlaintextRow(o, allowPlaintext));
  let done = 0;

  try {
    const snapshot = await buildEditPermissionSnapshot();
    const pending = migratable.filter((o) => canEditObjectType(snapshot, teamId, o.object_type, o.my_permissions));

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
    useTeamVaultStateStore.getState().setUnencryptedCount(teamId, migratable.length - done);
  }
}
