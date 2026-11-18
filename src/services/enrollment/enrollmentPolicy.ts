import type { TeamPolicyDoc } from "@/services/teamService";
import { EnrollmentError } from "./enrollmentApi";
import { postWithToken } from "./enrollmentPublic";
import type { EnrollmentTokenParts } from "./enrollmentToken";

export type EnrolledFetch =
  | { kind: "team"; team: { id: string; name: string; policy: TeamPolicyDoc | null; policyRevision: number } }
  | { kind: "unchanged"; name: string }
  | { kind: "drop" }
  | { kind: "keep" };

type PolicyReply = {
  unchanged?: boolean;
  name?: string;
  team?: { id: string; name: string; policy: TeamPolicyDoc | null; policy_revision: number };
};

const DROP_CODES = new Set(["ENROLLMENT_NOT_FOUND", "ENROLLMENT_REVOKED"]);

export async function fetchEnrolledPolicy(token: EnrollmentTokenParts, revision: number | null): Promise<EnrolledFetch> {
  try {
    const r = await postWithToken<PolicyReply>(token, "/v1/enrollment/policy", { revision });
    if (r.team) {
      const { id, name, policy, policy_revision } = r.team;
      return { kind: "team", team: { id, name, policy, policyRevision: policy_revision } };
    }
    return r.unchanged && typeof r.name === "string" ? { kind: "unchanged", name: r.name } : { kind: "keep" };
  } catch (e) {
    return e instanceof EnrollmentError && e.code && DROP_CODES.has(e.code) ? { kind: "drop" } : { kind: "keep" };
  }
}
