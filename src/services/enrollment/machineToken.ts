import { lockedString } from "@/stores/policyStore";
import { parseEnrollmentToken, type EnrollmentTokenParts } from "./enrollmentToken";

export function machineEnrollmentToken(): EnrollmentTokenParts | null {
  const raw = lockedString("enrollment.token");
  return raw ? parseEnrollmentToken(raw) : null;
}
