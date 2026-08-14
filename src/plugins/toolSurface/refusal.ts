export type Refusal = { refused: true; error: string } & Record<string, unknown>;

/**
 * A tool call that did nothing, returned as a value rather than thrown.
 *
 * `refused: true` is what marks it. Consumers must not infer a refusal from the
 * presence of an `error` field: a verb is free to return an error string
 * alongside real data, and that is still a success. Every place in the core tool
 * surface that declines to act builds its result here, so the marker cannot be
 * forgotten by one caller — and so a refusal can carry whatever helps the model
 * recover (`reason`, the connection list) without that extra field turning the
 * refusal back into a reported success.
 *
 * Its own module rather than `tools/helpers`: the connection guard needs it too,
 * and `helpers` sits downstream of `coreTools`.
 */
export function refusal(error: string, extra?: Record<string, unknown>): Refusal {
  return { ...extra, refused: true, error };
}

/** True for a value built by `refusal`, so a wrapper can pass it through rather
 *  than nesting it inside a reported success. */
export function isRefusal(value: unknown): value is Refusal {
  return typeof value === "object" && value !== null && (value as Refusal).refused === true;
}
