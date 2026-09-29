import { getMyUserId } from "@/services/teamService";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamObjectAccessStore } from "@/stores/teamObjectAccessStore";
import { resolveCan, type Permission } from "@/services/permissions";

/**
 * `resolveCan` bound to the live stores, for code that runs outside React.
 *
 * The user id cannot be read synchronously, so callers that already hold one
 * pass it; an empty string makes `resolveCan` pessimistic about team vaults,
 * which is the safe direction.
 */
export function canFromStores(myUserId: string): (permission: Permission, vaultId: string, objectId?: string) => boolean {
  const { teams, membersByTeam, rolesByTeam } = useTeamStore.getState();
  const vaults = useVaultStore.getState().vaults;
  const objectAccess = useTeamObjectAccessStore.getState().byTeam;
  return (permission, vaultId, objectId) =>
    resolveCan({ myUserId, teams, membersByTeam, rolesByTeam, vaults, objectAccess }, permission, vaultId, objectId);
}

/** `canFromStores` for callers that can await the user id themselves. */
export async function canFromStoresAsync(): Promise<(permission: Permission, vaultId: string, objectId?: string) => boolean> {
  const myUserId = (await getMyUserId().catch(() => null)) ?? "";
  return canFromStores(myUserId);
}
