import i18n from "@/i18n";
import { isInviteCode, parseInviteCode } from "@/services/inviteCode";
import { redeemSessionCode } from "@/services/multiplayerService";
import { isShortCode } from "@/services/shortCode";

/**
 * Turns anything a guest can paste or type — a bare `sessionId:token`, a
 * `voltius://join` link, or a short spoken code — into the pair every join needs.
 *
 * Only the short code costs a request: the other two already carry their token, so
 * detection stays synchronous and callers can decide what to offer before asking
 * the server anything.
 */
export async function resolveJoinInput(
  input: string,
): Promise<{ sessionId: string; inviteToken: string }> {
  const trimmed = input.trim();

  if (isInviteCode(trimmed)) {
    const parsed = parseInviteCode(trimmed);
    if (parsed) return { sessionId: parsed.sessionId, inviteToken: parsed.token };
  }

  if (isShortCode(trimmed)) return redeemSessionCode(trimmed);

  throw new Error(i18n.t("common.error.inviteCodeMalformed"));
}

/** True for anything `resolveJoinInput` can act on, without contacting the server. */
export function isJoinInput(input: string): boolean {
  const trimmed = input.trim();
  return isInviteCode(trimmed) || isShortCode(trimmed);
}
