import type { TFunction } from "i18next";
import { runTeamAction } from "@/services/teamActionFeedback";
import { useTeamStore } from "@/stores/teamStore";
import { enrollmentErrorMessage, enrollmentRefusal } from "./enrollmentApi";

interface EnrollmentActionOptions<T> {
  toast: string;
  bare402: "lapsed" | "noSeat";
  run: () => Promise<T>;
  warning?: (result: T) => string | null;
}

export async function runEnrollmentAction<T>(t: TFunction, { toast, bare402, run, warning }: EnrollmentActionOptions<T>): Promise<void> {
  try {
    await runTeamAction({
      pending: t(`${toast}.pending`),
      success: t(`${toast}.done`),
      warning,
      error: (e) => t(`${toast}.failed`, { reason: enrollmentErrorMessage(t, e, bare402) }),
      run,
    });
  } catch (e) {
    if (enrollmentRefusal(e, bare402) === "lapsed") void useTeamStore.getState().loadTeams();
  }
}
