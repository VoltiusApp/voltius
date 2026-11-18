import i18n from "@/i18n";
import { fetchWithTimeout } from "@/services/fetchWithTimeout";

/** What an emailed team invitation offers, read from the server it was sent from. */
export interface InvitationPreview {
  token: string;
  serverUrl: string;
  teamName: string;
  /** Absent on servers that predate invitation sign-up. */
  email: string | null;
  inviter: string;
  role: string;
}

const TOKEN_RE = /^[A-Za-z0-9]{32,128}$/;
const LINK_PATH_RE = /\/invite\/([A-Za-z0-9]{32,128})\/?$/;

/** The token from a pasted invitation link (`https://<portal>/invite/<token>`) or the bare token. */
export function parseInvitationInput(text: string): string | null {
  const trimmed = text.trim();
  if (TOKEN_RE.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return LINK_PATH_RE.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Null when the server holds no pending invitation under this token. */
export async function lookupInvitation(serverUrl: string, token: string): Promise<InvitationPreview | null> {
  const res = await fetchWithTimeout(`${serverUrl}/v1/invitations/${encodeURIComponent(token)}`, { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(i18n.t("common.error.invitationLookupFailed", { status: res.status }));
  const body = (await res.json()) as { team_name: string; email?: string; inviter_display_name?: string; role: string };
  const inviter = body.inviter_display_name;
  return {
    token,
    serverUrl,
    teamName: body.team_name,
    email: body.email ?? null,
    inviter: inviter && inviter !== "A teammate" ? `@${inviter}` : "",
    role: body.role,
  };
}

const REFUSAL_KEYS: Record<string, string> = {
  INVITATION_NOT_FOUND: "common.error.invitationNotFound",
  INVITATION_EMAIL_MISMATCH: "common.error.invitationEmailMismatch",
  INVITATION_WITHDRAWN: "common.error.invitationWithdrawn",
};

/** The register refusal that names the invitation, or null for any other. */
export function invitationRefusal(code: unknown): Error | null {
  const key = typeof code === "string" ? REFUSAL_KEYS[code] : undefined;
  return key ? new Error(i18n.t(key)) : null;
}

/** Registration is closed on this server: an invitation is the only way in. */
export class RegistrationClosedError extends Error {}

/** A refusal the form already explains in place, so it carries no message of its own. */
export class ExplainedInFormError extends Error {
  constructor() {
    super("");
  }
}
