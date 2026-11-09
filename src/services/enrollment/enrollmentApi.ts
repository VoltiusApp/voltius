import type { TFunction } from "i18next";
import { userFacingReason } from "@/services/errorReason";
import { featureDisabledError } from "@/services/featureDisabled";
import { serverFetch } from "@/services/teamService";

export class EnrollmentError extends Error {
  constructor(public code: string | null, public status: number, message?: string, public retryAfterMs?: number) {
    super(message ?? code ?? `HTTP ${status}`);
  }
}

export type EnrollmentRefusal =
  | "lapsed" | "noSeat" | "needsGuard" | "needsApproval" | "domainMismatch" | "invitesOff" | "invalid" | "forbidden" | "notFound" | "gone";

const REFUSAL_BY_CODE: Record<string, EnrollmentRefusal> = {
  ENROLLMENT_NOT_FOUND: "notFound",
  ENROLLMENT_UNAVAILABLE: "lapsed",
  ENROLLMENT_NEEDS_GUARD: "needsGuard",
  ENROLLMENT_NEEDS_APPROVAL: "needsApproval",
  ENROLLMENT_DOMAIN_MISMATCH: "domainMismatch",
  TEAM_INVITES_DISABLED: "invitesOff",
};
const REFUSAL_BY_STATUS: Record<number, EnrollmentRefusal> = { 400: "invalid", 403: "forbidden", 404: "notFound", 410: "gone" };

const REFUSAL_MESSAGE: Record<EnrollmentRefusal, string> = {
  lapsed: "members.enrollment.lapsed",
  noSeat: "members.joinRequests.noSeatToast",
  needsGuard: "members.enrollment.error.needsGuard",
  needsApproval: "members.enrollment.error.needsApproval",
  domainMismatch: "members.enrollment.error.domainMismatch",
  invitesOff: "common.error.teamInvitesDisabled",
  invalid: "members.enrollment.error.invalid",
  forbidden: "members.enrollment.error.forbidden",
  notFound: "members.joinRequests.gone",
  gone: "members.enrollment.error.gone",
};

/** `bare402`: an uncoded 402 means a lapsed plan on token routes, a missing seat on approve. */
export function enrollmentRefusal(e: unknown, bare402: "lapsed" | "noSeat"): EnrollmentRefusal | null {
  if (!(e instanceof EnrollmentError)) return null;
  const coded = e.code ? REFUSAL_BY_CODE[e.code] : undefined;
  if (coded) return coded;
  return e.status === 402 ? bare402 : REFUSAL_BY_STATUS[e.status] ?? null;
}

export function enrollmentErrorMessage(t: TFunction, e: Error, bare402: "lapsed" | "noSeat"): string {
  const refusal = enrollmentRefusal(e, bare402);
  return refusal ? t(REFUSAL_MESSAGE[refusal]) : userFacingReason(e);
}

export interface EnrollmentTokenBody {
  role?: string;
  allowed_domains: string[];
  require_approval: boolean;
  expires_at: string | null;
}

export interface CreatedEnrollmentToken {
  id: string;
  secret: string;
  role: string;
  allowed_domains: string[];
  require_approval: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface EnrollmentTokenInfo extends Omit<CreatedEnrollmentToken, "secret"> {
  created_by_name: string | null;
  last_used_at: string | null;
  admitted_count: number;
  pending_count: number;
}

export type JoinRequestReason = "approval" | "email_unverified" | "seat_limit";

export interface JoinRequest {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  reason: JoinRequestReason;
  email_proven: boolean;
  created_at: string;
}

export interface ApproveOutcome {
  status: "member" | "admitted" | "pending";
  reason?: JoinRequestReason;
}

const tokenPath = (teamId: string) => `/v1/teams/${teamId}/enrollment-token`;
const requestsPath = (teamId: string) => `/v1/teams/${teamId}/join-requests`;
export const JSON_HEADERS = { "Content-Type": "application/json" };

export async function enrollmentErrorFrom(res: { status: number; headers?: Headers; json(): Promise<unknown> }): Promise<EnrollmentError> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const disabled = await featureDisabledError({ status: res.status, json: async () => body });
  const retryAfter = Number(res.headers?.get("Retry-After"));
  return new EnrollmentError(
    typeof body?.error === "string" ? body.error : null,
    res.status,
    disabled?.message,
    retryAfter > 0 ? retryAfter * 1000 : undefined,
  );
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await serverFetch(path, init);
  if (!res.ok) throw await enrollmentErrorFrom(res);
  return res.status === 204 ? (undefined as T) : res.json();
}

export const enrollmentApi = {
  getToken: async (teamId: string) =>
    (await call<{ token: EnrollmentTokenInfo | null }>(tokenPath(teamId))).token,
  createToken: (teamId: string, body: EnrollmentTokenBody) =>
    call<CreatedEnrollmentToken>(tokenPath(teamId), { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) }),
  revokeToken: (teamId: string) => call<void>(tokenPath(teamId), { method: "DELETE" }),
  listJoinRequests: (teamId: string) => call<JoinRequest[]>(`${requestsPath(teamId)}?status=pending`),
  approveJoinRequest: (teamId: string, rid: string) =>
    call<ApproveOutcome>(`${requestsPath(teamId)}/${rid}/approve`, { method: "POST" }),
  denyJoinRequest: (teamId: string, rid: string) =>
    call<void>(`${requestsPath(teamId)}/${rid}/deny`, { method: "POST" }),
};
