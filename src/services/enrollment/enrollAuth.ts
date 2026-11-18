import { getAccountId } from "@/services/account";
import { afterSecondFactor } from "@/services/twoFactorProof";
import type { EnrollmentOutcome } from "./enrollmentPublic";

export type EnrollSession = { serverUrl: string; jwt: string } | "active";

export interface EnrollAuthResult {
  outcome: EnrollmentOutcome | null;
  session: EnrollSession;
  accountId: string;
}

/** Every enrol sign-in goes through here, so a second factor resumes into an `EnrollAuthResult` too. */
export const enrollAuthStep = <T>(work: () => Promise<T>, build: (result: T) => Promise<EnrollAuthResult>) =>
  afterSecondFactor(work, build);

export const activeEnrollSession = async (outcome: EnrollmentOutcome | null): Promise<EnrollAuthResult> =>
  ({ outcome, session: "active", accountId: (await getAccountId()) ?? "" });
