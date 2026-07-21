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
