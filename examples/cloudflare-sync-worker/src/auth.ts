/** SHA-256 digest bytes for constant-length compares. */
async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return new Uint8Array(digest);
}

/** Constant-time compare of equal-length byte arrays. */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}

/** @deprecated kept for unit tests of string helper shape — prefer digest compare. */
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
 * Compares SHA-256 digests so token length is not leaked via early exit.
 */
export async function requireSyncToken(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const expected = env.SYNC_TOKEN;
  if (!expected) {
    return jsonError(
      500,
      "misconfigured",
      "SYNC_TOKEN secret is not configured on this Worker",
    );
  }
  const provided = extractBearerToken(request);
  if (!provided) {
    return jsonError(401, "unauthorized", "Invalid or missing bearer token");
  }
  const [got, want] = await Promise.all([sha256Bytes(provided), sha256Bytes(expected)]);
  if (!timingSafeEqualBytes(got, want)) {
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
      ...(status === 401
        ? { "www-authenticate": 'Bearer realm="voltius-cloudflare-sync"' }
        : {}),
    },
  });
}
