/** SHA-256 of `text` (UTF-8) as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Thrown when a fetched plugin bundle does not match its reviewed hash. */
export class PluginHashMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Plugin bundle hash mismatch: expected ${expected}, got ${actual}`);
    this.name = "PluginHashMismatchError";
  }
}

/**
 * Verify a fetched `index.js` against its reviewed hash.
 * - No expected hash → returns null (installs "unverified").
 * - Match (case-insensitive) → returns the computed lowercase hash.
 * - Mismatch → throws PluginHashMismatchError (caller must not execute the bundle).
 */
export async function resolveVerifiedHash(
  jsText: string,
  expected: string | undefined | null,
): Promise<string | null> {
  if (!expected) return null;
  const actual = await sha256Hex(jsText);
  if (actual !== expected.toLowerCase()) {
    throw new PluginHashMismatchError(expected.toLowerCase(), actual);
  }
  return actual;
}
