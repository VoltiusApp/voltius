import i18n from "@/i18n";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { runTeamAction } from "@/services/teamActionFeedback";
import { markTeamVaultLoadedAfterLocalActivation } from "@/services/teamVaultActivation";
import { migrateVaultToTeam } from "@/services/vaultTeamMigration";
import { deleteTeam } from "@/services/teamService";

/**
 * Turn a private vault into a team vault, carrying its existing contents over.
 *
 * Deliberately does not invite anyone. Conversion used to be a side effect of
 * the first invite, which meant one handler could convert the vault and then
 * fail the invite with nothing rendered.
 *
 * Either the whole conversion lands or none of it does: a vault that ends up
 * linked to a team whose contents never uploaded looks complete to its owner
 * while every teammate sees it empty, so a failure undoes the link and the team.
 */
export async function createTeamVaultFromVault(vaultId: string, vaultName: string): Promise<string> {
  const team = await useTeamStore.getState().createTeam(vaultName);
  useVaultStore.getState().setVaultTeamId(vaultId, team.id);
  try {
    const { initTeamVaultKey } = await import("@/services/teamVaultSync");
    await initTeamVaultKey(team.id, []);
    await migrateVaultToTeam(vaultId, team.id);
  } catch (e) {
    useVaultStore.getState().setVaultTeamId(vaultId, null);
    useTeamStore.getState().removeTeam(team.id);
    await deleteTeam(team.id).catch(() => {});
    throw e;
  }
  markTeamVaultLoadedAfterLocalActivation(team.id, useTeamVaultStateStore.getState());
  return team.id;
}

/** `createTeamVaultFromVault` with the shared progress/success/error toast. */
export async function convertVaultToTeam(vaultId: string, vaultName: string): Promise<string> {
  return runTeamAction({
    pending: i18n.t("members.toast.convertingVault", { vault: vaultName }),
    success: i18n.t("members.toast.vaultConverted", { vault: vaultName }),
    error: (e: Error) => i18n.t("members.error.convertFailed", { vault: vaultName, reason: e.message }),
    run: () => createTeamVaultFromVault(vaultId, vaultName),
  });
}
