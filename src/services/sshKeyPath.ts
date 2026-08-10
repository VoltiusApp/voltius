/**
 * Where a key deployment is allowed to write, decided in one place.
 *
 * The destination is a directory RELATIVE to the remote home and a bare
 * filename: an absolute path, or a "." / ".." segment, turns the deployment
 * into an arbitrary remote file write (/etc/cron.d, ~/.bashrc). Shell
 * metacharacters and whitespace are refused too — both halves land inside a
 * shell command.
 *
 * No imports on purpose: the MCP schema, the plugin API and the panel all reach
 * this, and `addKeyToHost` enforces it so no caller can go around it.
 */
const UNSAFE_SEGMENT_CHAR = /[\s'";$`]/;

const isSafeSegment = (segment: string): boolean =>
  segment.length > 0 && segment !== "." && segment !== ".." && !UNSAFE_SEGMENT_CHAR.test(segment);

export function isSafeRelativeDir(value: string): boolean {
  return !value.startsWith("/") && value.split("/").every(isSafeSegment);
}

export function isSafeFilename(value: string): boolean {
  return !value.includes("/") && isSafeSegment(value);
}
