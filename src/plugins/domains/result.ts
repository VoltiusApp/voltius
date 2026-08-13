/**
 * The shape a domain declines a write with instead of throwing, so a refusal
 * the caller is expected to read (a role the server rejects, a session already
 * shared) arrives as data rather than an exception.
 */
export type DomainResult<T> = { ok: true; result: T } | { ok: false; error: string };

export const failed = (err: unknown): { ok: false; error: string } =>
  ({ ok: false, error: err instanceof Error ? err.message : String(err) });
