import i18n from "@/i18n";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { runTeamAction } from "@/services/teamActionFeedback";
import { markTeamVaultLoadedAfterLocalActivation } from "@/services/teamVaultActivation";

/**
 * Turn a private vault into a team vault.
 *
 * Deliberately does not invite anyone. Conversion used to be a side effect of
 * the first invite, which meant one handler could convert the vault and then
 * fail the invite with nothing rendered.
 */
export async function convertVaultToTeam(vaultId: string, vaultName: string): Promise<string> {
  return runTeamAction({
    pending: i18n.t("members.toast.convertingVault", { vault: vaultName }),
    success: i18n.t("members.toast.vaultConverted", { vault: vaultName }),
    error: (e: Error) => i18n.t("members.error.convertFailed", { vault: vaultName, reason: e.message }),
    run: async () => {
      const team = await useTeamStore.getState().createTeam(vaultName);
      useVaultStore.getState().setVaultTeamId(vaultId, team.id);
      const { initTeamVaultKey } = await import("@/services/teamVaultSync");
      await initTeamVaultKey(team.id, []);
      markTeamVaultLoadedAfterLocalActivation(team.id, useTeamVaultStateStore.getState());
      return team.id;
    },
  });
}
