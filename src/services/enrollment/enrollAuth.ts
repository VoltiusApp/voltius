import { TwoFactorRequiredError } from "@/services/twoFactorProof";
import type { EnrollmentOutcome } from "./enrollmentPublic";

export type EnrollSession = { serverUrl: string; jwt: string } | "active";

export interface EnrollAuthResult {
  outcome: EnrollmentOutcome | null;
  session: EnrollSession;
  accountId: string;
}

/** Every enrol sign-in goes through here, so a second factor resumes into an `EnrollAuthResult` too. */
export async function enrollAuthStep<T>(
  work: () => Promise<T>,
  build: (result: T) => Promise<EnrollAuthResult>,
): Promise<EnrollAuthResult> {
  let result: T;
  try {
    result = await work();
  } catch (e) {
    if (!(e instanceof TwoFactorRequiredError)) throw e;
    const step = e as TwoFactorRequiredError<T>;
    throw new TwoFactorRequiredError(step.methods, (proof) => enrollAuthStep(() => step.complete(proof), build), step.openPasskey);
  }
  return build(result);
}
