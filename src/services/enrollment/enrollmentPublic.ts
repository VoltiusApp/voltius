import { appFetch } from "@/services/http";
import { serverFetch } from "@/services/teamService";
import { canonicalServerUrl } from "@/utils/serverInstance";
import { EnrollmentError, enrollmentErrorFrom, enrollmentRefusal, type JoinRequestReason } from "./enrollmentApi";
import type { EnrollmentTokenParts } from "./enrollmentToken";

export interface ResolvedEnrollment {
  teamId: string;
  teamName: string;
  allowedDomains: string[];
  requireApproval: boolean;
}

export type EnrollmentCredential = { id: string; secret: string };

export interface EnrollmentOutcome {
  status: "member" | "admitted" | "pending";
  reason?: JoinRequestReason;
  teamId?: string;
}

export interface MyJoinRequest {
  id: string;
  teamId: string;
  teamName: string;
  status: "pending" | "denied";
  reason?: JoinRequestReason;
  createdAt: string;
  decidedAt?: string;
}

export type ResolveFailure = "notFound" | "gone" | "lapsed" | "invitesOff" | "serverTooOld" | "rateLimited" | "unreachable";

export class ResolveFailedError extends Error {
  constructor(public failure: ResolveFailure) {
    super(failure);
  }
}

type Session = { serverUrl: string; jwt?: string };

const REQUEST_TIMEOUT_MS = 10_000;
const JSON_HEADERS = { "Content-Type": "application/json" };

export function enrollmentCredential(token: EnrollmentTokenParts): EnrollmentCredential {
  const { id, secret } = token;
  return { id: id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"), secret };
}

export function toEnrollmentOutcome(raw: unknown): EnrollmentOutcome | null {
  const o = raw as { status?: unknown; reason?: JoinRequestReason; team_id?: string } | null;
  if (o?.status !== "member" && o?.status !== "admitted" && o?.status !== "pending") return null;
  return { status: o.status, ...(o.reason && { reason: o.reason }), ...(o.team_id && { teamId: o.team_id }) };
}

async function request<T>(session: Session | "active", path: string, init: RequestInit): Promise<T> {
  const res =
    session === "active"
      ? await serverFetch(path, init)
      : await appFetch(`${canonicalServerUrl(session.serverUrl)}${path}`, {
          ...init,
          headers: { ...JSON_HEADERS, ...(session.jwt && { Authorization: `Bearer ${session.jwt}` }) },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          connectTimeout: REQUEST_TIMEOUT_MS,
        });
  if (!res.ok) throw await enrollmentErrorFrom(res);
  return res.json();
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });

export async function resolveEnrollment(token: EnrollmentTokenParts): Promise<ResolvedEnrollment> {
  const r = await request<{ team_id: string; team_name: string; allowed_domains: string[]; require_approval: boolean }>(
    { serverUrl: token.serverUrl },
    "/v1/enrollment/resolve",
    post(enrollmentCredential(token)),
  );
  return { teamId: r.team_id, teamName: r.team_name, allowedDomains: r.allowed_domains, requireApproval: r.require_approval };
}

export async function redeemEnrollment(
  token: EnrollmentTokenParts,
  session: { serverUrl: string; jwt: string } | "active",
): Promise<EnrollmentOutcome> {
  const body: Record<string, string> = { ...enrollmentCredential(token) };
  if (session === "active") {
    const { getMyX25519Keypair } = await import("@/services/multiplayerService");
    body.public_key = (await getMyX25519Keypair()).publicKey;
  }
  const outcome = toEnrollmentOutcome(await request<unknown>(session, "/v1/enrollment/redeem", post(body)));
  if (!outcome) throw new EnrollmentError(null, 502);
  return outcome;
}

export async function listMyJoinRequests(): Promise<MyJoinRequest[] | null> {
  try {
    const rows = await request<
      Array<{ id: string; team_id: string; team_name: string; status: "pending" | "denied"; reason?: JoinRequestReason; created_at: string; decided_at?: string }>
    >("active", "/v1/enrollment/requests", {});
    return rows.map((r) => ({
      id: r.id,
      teamId: r.team_id,
      teamName: r.team_name,
      status: r.status,
      reason: r.reason,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
    }));
  } catch (e) {
    if (e instanceof EnrollmentError && e.status === 404) return null;
    throw e;
  }
}

export function resolveFailure(e: unknown): ResolveFailure {
  if (e instanceof ResolveFailedError) return e.failure;
  if (!(e instanceof EnrollmentError)) return "unreachable";
  if (e.status === 404 && !e.code) return "serverTooOld";
  if (e.status === 429) return "rateLimited";
  const refusal = enrollmentRefusal(e, "lapsed");
  return refusal === "notFound" || refusal === "gone" || refusal === "lapsed" || refusal === "invitesOff" ? refusal : "unreachable";
}

export function emailDomainAllowed(email: string, domains: string[]): boolean {
  if (domains.length === 0) return true;
  const at = email.lastIndexOf("@");
  return at >= 0 && domains.includes(email.slice(at + 1).toLowerCase());
}
