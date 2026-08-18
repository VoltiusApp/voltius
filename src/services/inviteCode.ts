import { buildDeepLink, parseDeepLink } from "./deepLinkUrl";
import { isSessionId } from "./sessionId";

export { isSessionId };

export function buildInviteCode(sessionId: string, token: string): string {
  return `${sessionId}:${token}`;
}

export function buildInviteLink(sessionId: string, token: string): string {
  return buildDeepLink({ route: "join", sessionId, token });
}

export function parseInviteCode(code: string): { sessionId: string; token: string } | null {
  const trimmed = code.trim();
  const asLink = parseDeepLink(trimmed);
  if (asLink && asLink.route === "join") return { sessionId: asLink.sessionId, token: asLink.token };
  // A rejected URL is not a bare `sessionId:token`, despite the colons.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null;
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx === -1) return null;
  const sessionId = trimmed.slice(0, colonIdx);
  const token = trimmed.slice(colonIdx + 1);
  if (!sessionId || !token) return null;
  return { sessionId, token };
}

export function isInviteCode(value: string): boolean {
  const parsed = parseInviteCode(value);
  return parsed !== null && isSessionId(parsed.sessionId);
}
