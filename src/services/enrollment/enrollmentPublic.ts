import { fetchWithTimeout } from "@/services/fetchWithTimeout";
import { serverFetch } from "@/services/teamService";
import { canonicalServerUrl, DEFAULT_SERVER_URL, instanceLabel, sameServer } from "@/utils/serverInstance";
import {
  EnrollmentError,
  enrollmentErrorFrom,
  enrollmentRefusal,
  JSON_HEADERS,
  type EnrollmentRefusal,
  type JoinRequestReason,
} from "./enrollmentApi";
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

export type ResolveFailure = "notFound" | "gone" | "lapsed" | "invitesOff" | "serverTooOld" | "rateLimited" | "unreachable" | "blocked";

export class ResolveFailedError extends Error {
  constructor(public failure: ResolveFailure) {
    super(failure);
  }
}

type Session = { serverUrl: string; jwt?: string };

export function enrollmentCredential(token: EnrollmentTokenParts): EnrollmentCredential {
  const { id, secret } = token;
  return { id: id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"), secret };
}

export function toEnrollmentOutcome(raw: unknown): EnrollmentOutcome | null {
  const o = raw as { status?: unknown; reason?: JoinRequestReason; team_id?: string } | null;
  if (o?.status !== "member" && o?.status !== "admitted" && o?.status !== "pending") return null;
  return { status: o.status, ...(o.reason && { reason: o.reason }), ...(o.team_id && { teamId: o.team_id }) };
}

type Init = { method?: string; headers?: Record<string, string>; body?: string };

async function request<T>(session: Session | "active", path: string, init: Init): Promise<T> {
  const res =
    session === "active"
      ? await serverFetch(path, init)
      : await fetchWithTimeout(`${canonicalServerUrl(session.serverUrl)}${path}`, {
          ...init,
          headers: { ...init.headers, ...(session.jwt && { Authorization: `Bearer ${session.jwt}` }) },
        });
  if (!res.ok) throw await enrollmentErrorFrom(res);
  return res.json();
}

const post = (body: unknown): Init => ({ method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });

export const postWithToken = <T>(token: EnrollmentTokenParts, path: string, extra: Record<string, unknown> = {}) =>
  request<T>({ serverUrl: token.serverUrl }, path, post({ ...enrollmentCredential(token), ...extra }));

export async function resolveEnrollment(token: EnrollmentTokenParts): Promise<ResolvedEnrollment> {
  const r = await postWithToken<{ team_id: string; team_name: string; allowed_domains: string[]; require_approval: boolean }>(
    token,
    "/v1/enrollment/resolve",
  );
  return { teamId: r.team_id, teamName: r.team_name, allowedDomains: r.allowed_domains, requireApproval: r.require_approval };
}

export async function redeemEnrollment(
  token: EnrollmentTokenParts,
  session: { serverUrl: string; jwt: string } | "active",
): Promise<EnrollmentOutcome> {
  if (session !== "active" && !sameServer(session.serverUrl, token.serverUrl)) {
    throw new Error("enrolment session is on another server than its token");
  }
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

const JOIN_REFUSALS = ["notFound", "gone", "lapsed", "invitesOff", "domainMismatch"] as const;
export type JoinRefusal = (typeof JOIN_REFUSALS)[number] & EnrollmentRefusal;

/** A refusal of the token itself, as opposed to a transport or account failure. */
export function joinRefusal(e: unknown): JoinRefusal | null {
  const refusal = enrollmentRefusal(e, "lapsed");
  return JOIN_REFUSALS.find((r) => r === refusal) ?? null;
}

export function resolveFailure(e: unknown): ResolveFailure {
  if (e instanceof ResolveFailedError) return e.failure;
  if (!(e instanceof EnrollmentError)) return "unreachable";
  if (e.status === 404 && !e.code) return "serverTooOld";
  if (e.status === 429) return "rateLimited";
  const refusal = joinRefusal(e);
  return refusal && refusal !== "domainMismatch" ? refusal : "unreachable";
}

export type EnrollFailure = ResolveFailure | "domainMismatch";
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The server a token names, as shown to people; a cleartext server keeps its `http://`. */
export function tokenHost(serverUrl: string): string {
  const label = instanceLabel(serverUrl);
  const cleartext = canonicalServerUrl(serverUrl)?.startsWith("http:");
  return cleartext ? `http://${label ?? new URL(serverUrl).host}` : (label ?? DEFAULT_SERVER_URL);
}

export const atDomains = (domains: string[]) => domains.map((d) => `@${d}`).join(", ");

export function enrollFailureText(failure: EnrollFailure, t: Translate, ctx: { team?: string; host: string; domains?: string[] }): string {
  switch (failure) {
    case "blocked": return t("common.policy.serverBlocked");
    case "notFound":
    case "gone": return t("layout.enroll.error.gone");
    case "lapsed": return ctx.team ? t("layout.enroll.error.lapsed", { team: ctx.team }) : t("layout.enroll.error.lapsedNoTeam");
    case "invitesOff": return t("common.error.teamInvitesDisabled");
    case "unreachable": return t("layout.enroll.error.unreachable", { host: ctx.host });
    case "domainMismatch": return t("layout.enroll.domainError", { team: ctx.team, domains: atDomains(ctx.domains ?? []) });
    default: return t(`layout.enroll.error.${failure}`);
  }
}

export function emailDomainAllowed(email: string, domains: string[]): boolean {
  if (domains.length === 0) return true;
  const at = email.lastIndexOf("@");
  return at >= 0 && domains.some((d) => d.toLowerCase() === email.slice(at + 1).toLowerCase());
}
