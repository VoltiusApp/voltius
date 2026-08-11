/**
 * Where a key deployment is allowed to write, decided in one place.
 *
 * The destination is a directory RELATIVE to the remote home and a bare
 * filename: an absolute path, or a "." / ".." segment, turns the deployment
 * into an arbitrary remote file write (/etc/cron.d, ~/.bashrc). Shell
 * metacharacters, backslash and whitespace are refused too — both halves land
 * inside a shell command.
 *
 * Every input is checked for being a string first. Plugins run in-process and
 * are handed the API object itself, so a TypeScript signature is not a runtime
 * guarantee: an object with its own `startsWith`/`split`/`includes` would
 * otherwise satisfy these predicates and reach `shellQuote`, which would then
 * call the caller's own `replace`.
 *
 * No imports on purpose: the MCP schema, the plugin API and the panel all reach
 * this, and `addKeyToHost` enforces it so no caller can go around it.
 */
const UNSAFE_SEGMENT_CHAR = /[\s'";$`\\\x00]/;

/**
 * Files sshd itself interprets, refused as a destination. The CONTENT rule —
 * a public key with no shell metacharacters in its comment — is what actually
 * makes an append to ~/.ssh/rc inert; this is a tripwire for a future edit that
 * relaxes that charset, NOT the control, and must never be read as licence to
 * relax it.
 */
const SSHD_INTERPRETED = new Set(["rc", "environment"]);

const isSafeSegment = (segment: string): boolean =>
  segment.length > 0 && segment !== "." && segment !== ".." && !UNSAFE_SEGMENT_CHAR.test(segment);

export function isSafeRelativeDir(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return !value.startsWith("/") && value.split("/").every(isSafeSegment);
}

export function isSafeFilename(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (SSHD_INTERPRETED.has(value.toLowerCase())) return false;
  return !value.includes("/") && isSafeSegment(value);
}
