import { getMyUserId } from "@/services/teamService";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { resolveCan, type Permission } from "@/services/permissions";

/**
 * `resolveCan` bound to the live stores, for code that runs outside React.
 *
 * The user id cannot be read synchronously, so callers that already hold one
 * pass it; an empty string makes `resolveCan` pessimistic about team vaults,
 * which is the safe direction.
 */
export function canFromStores(myUserId: string): (permission: Permission, vaultId: string) => boolean {
  const { teams, membersByTeam, rolesByTeam } = useTeamStore.getState();
  const vaults = useVaultStore.getState().vaults;
  return (permission, vaultId) =>
    resolveCan({ myUserId, teams, membersByTeam, rolesByTeam, vaults }, permission, vaultId);
}

/** `canFromStores` for callers that can await the user id themselves. */
export async function canFromStoresAsync(): Promise<(permission: Permission, vaultId: string) => boolean> {
  const myUserId = (await getMyUserId().catch(() => null)) ?? "";
  return canFromStores(myUserId);
}
