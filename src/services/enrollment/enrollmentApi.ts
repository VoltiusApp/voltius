import { featureDisabledError } from "@/services/featureDisabled";
import { serverFetch } from "@/services/teamService";

export class EnrollmentError extends Error {
  constructor(public code: string | null, public status: number) {
    super(code ?? `HTTP ${status}`);
  }
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
const JSON_HEADERS = { "Content-Type": "application/json" };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await serverFetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const disabled = await featureDisabledError({ status: res.status, json: async () => body });
    if (disabled) throw disabled;
    throw new EnrollmentError(typeof body?.error === "string" ? body.error : null, res.status);
  }
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
