import { assertNotPreviewing } from "@/services/previewGuard";
import { checkAndRotateTeamKey, type RotationPass } from "@/services/teamKeyRotation";
import { deleteTeamObject, deleteTeamSecret } from "@/services/teamObjects";
import type { StaleItem } from "@/services/teamService";

/** A rotation the user asked for; automatic passes call checkAndRotateTeamKey directly. */
export async function rotateTeamKeyNow(teamId: string): Promise<RotationPass> {
  assertNotPreviewing();
  return checkAndRotateTeamKey(teamId);
}

export async function removeStaleItem(teamId: string, item: StaleItem): Promise<void> {
  assertNotPreviewing();
  await (item.kind === "secret" ? deleteTeamSecret(teamId, item.secret_id!) : deleteTeamObject(teamId, item.object_id!));
}
