export function buildInviteCode(sessionId: string, token: string): string {
  return `${sessionId}:${token}`;
}

export function parseInviteCode(code: string): { sessionId: string; token: string } | null {
  const trimmed = code.trim();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx === -1) return null;
  const sessionId = trimmed.slice(0, colonIdx);
  const token = trimmed.slice(colonIdx + 1);
  if (!sessionId || !token) return null;
  return { sessionId, token };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isInviteCode(value: string): boolean {
  const parsed = parseInviteCode(value);
  return parsed !== null && UUID_RE.test(parsed.sessionId);
}
