import i18n from "@/i18n";
import { fetchAuth } from "./authFetch";
import { adoptSessionTokens, getServerUrl, refreshAccessToken } from "./authTokens";

export interface SignedInSession {
  id: string;
  device_name: string | null;
  platform: string | null;
  client: string | null;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

async function request(path: string, method = "GET"): Promise<Response> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) throw new Error(i18n.t("common.error.notConnectedToServer"));
  return fetchAuth(`${serverUrl}/v1/auth/sessions${path}`, { method });
}

function ok(res: Response): Response {
  if (!res.ok) throw new Error(i18n.t("common.error.serverError", { status: res.status }));
  return res;
}

async function fetchSessions(): Promise<SignedInSession[] | null> {
  const res = await request("");
  if (res.status === 404) return null;
  return ((await ok(res).json()) as { sessions: SignedInSession[] }).sessions;
}

/** Null on a server without sessions. */
export async function listSessions(): Promise<SignedInSession[] | null> {
  const sessions = await fetchSessions();
  // A token from before sessions is not listed until a refresh names this device.
  if (!sessions || sessions.some((s) => s.current)) return sessions;
  return typeof (await refreshAccessToken()) === "string" ? sessions : fetchSessions();
}

/** Ends this device's session through the usual path: the refresh is refused and the user is told to sign in again. */
async function endThisSession(): Promise<void> {
  await refreshAccessToken();
}

export async function revokeSession(session: SignedInSession): Promise<void> {
  const res = await request(`/${encodeURIComponent(session.id)}`, "DELETE");
  if (res.status !== 404) ok(res);
  if (session.current) await endThisSession();
}

export async function revokeOtherSessions(): Promise<void> {
  const res = ok(await request("/revoke-others", "POST"));
  await adoptSessionTokens(await res.json());
}

export async function revokeAllSessions(): Promise<void> {
  ok(await request("/revoke-all", "POST"));
  await endThisSession();
}
