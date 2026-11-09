import { lockedString } from "@/stores/policyStore";
import { useDeepLinkStore } from "@/stores/deepLinkStore";
import type { EnrollTarget } from "@/stores/uiStore";
import { parseEnrollmentToken, type EnrollmentTokenParts } from "./enrollmentToken";

export function machineEnrollmentToken(): EnrollmentTokenParts | null {
  const raw = lockedString("enrollment.token");
  return raw ? parseEnrollmentToken(raw) : null;
}

export function takeEnrollLink(): EnrollTarget | null {
  const link = useDeepLinkStore.getState().takeQueued("enroll");
  const token = link && parseEnrollmentToken(link.token);
  return token ? { token, source: "link" } : null;
}
