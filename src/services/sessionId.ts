const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every server-issued id is a UUID: sessions, users, teams, join grants. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** The same check under the name most call sites read it by. */
export const isSessionId = isUuid;
