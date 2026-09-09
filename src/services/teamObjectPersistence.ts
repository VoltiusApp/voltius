import { deleteTeamObject, upsertTeamObject, type TeamObjectType } from "@/services/teamObjects";
import { encodeObjectMetadata } from "@/services/teamObjectEnvelope";

interface PersistableTeamObject {
  id: string;
  name?: string;
  folder_id?: string;
}

export async function saveTeamVaultObject<T extends PersistableTeamObject>(
  teamId: string,
  objectType: TeamObjectType,
  item: T,
): Promise<void> {
  // name and folder_id are sent as null: the server stopped persisting them
  // (#229) and no client ever read them back — every field comes from the
  // metadata blob, which is now encrypted under the team DEK.
  await upsertTeamObject(teamId, {
    object_id: item.id,
    object_type: objectType,
    name: null,
    folder_id: null,
    metadata: await encodeObjectMetadata(teamId, item),
  });
}

export async function removeTeamVaultObject(teamId: string, objectId: string): Promise<void> {
  await deleteTeamObject(teamId, objectId);
}
