import i18n from "@/i18n";

const URL_IN_MESSAGE = /https?:\/\//i;

/**
 * A raw transport failure (no HTTP response — fetch/reqwest rejected before a
 * status came back) can embed the server URL in its message, e.g. "error
 * sending request for url (http://host:port/...)". That must never reach the
 * UI, so collapse it to a translated, URL-free reason; any other error is
 * already a short, translated, URL-free message and passes through as-is.
 */
export function userFacingReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return URL_IN_MESSAGE.test(message) ? i18n.t("members.error.serverUnreachable") : message;
}
