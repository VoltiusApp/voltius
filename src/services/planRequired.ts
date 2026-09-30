import i18n from "@/i18n";

export function planRequiredError(): Error {
  return Object.assign(new Error(i18n.t("common.error.businessPlanRequired")), { code: 402, status: 402 });
}

export function refuseIfPlanRequired(res: Response): void {
  if (res.status !== 402) return;
  // Dynamic: teamStore imports teamService, which imports this module.
  void import("@/stores/teamStore").then((m) => m.useTeamStore.getState().loadTeams());
  throw planRequiredError();
}
