/** Constant-time string compare for equal-length secrets. */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Returns null when authorized; otherwise a Response to return to the client.
 * /health and other non-/v1 routes should not call this.
 */
export function requireSyncToken(request: Request, env: Env): Response | null {
  const expected = env.SYNC_TOKEN;
  if (!expected) {
    return jsonError(
      500,
      "misconfigured",
      "SYNC_TOKEN secret is not configured on this Worker",
    );
  }
  const provided = extractBearerToken(request);
  if (!provided || !timingSafeEqualString(provided, expected)) {
    return jsonError(401, "unauthorized", "Invalid or missing bearer token");
  }
  return null;
}

export function jsonError(
  status: number,
  error: string,
  message: string,
): Response {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "www-authenticate": 'Bearer realm="voltius-cloudflare-sync"',
    },
  });
}
