import { deleteTeamObject, upsertTeamObject, type TeamObjectType } from "@/services/teamObjects";

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
  await upsertTeamObject(teamId, {
    object_id: item.id,
    object_type: objectType,
    name: item.name,
    folder_id: item.folder_id,
    metadata: item,
  });
}

export async function removeTeamVaultObject(teamId: string, objectId: string): Promise<void> {
  await deleteTeamObject(teamId, objectId);
}
