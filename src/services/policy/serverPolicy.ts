import { adminDefault, lockedBool, lockedList, lockedString } from "@/stores/policyStore";
import { DEFAULT_SERVER_URL, normalizeServerUrl, sameServer, storedServerUrl } from "@/utils/serverInstance";

export function policyServerUrl(): string | null {
  const pinned = lockedString("server.url");
  return pinned === undefined ? null : normalizeServerUrl(pinned);
}

export function initialServerUrl(last: string): string {
  const fallback = adminDefault("server.url");
  return policyServerUrl() ?? (last || (typeof fallback === "string" ? fallback : last));
}

export const startingServerUrl = (): string => initialServerUrl(storedServerUrl()) || DEFAULT_SERVER_URL;

export function resolveServerUrl(input: string): string {
  return policyServerUrl() ?? normalizeServerUrl(input);
}

export function serverAllowed(serverUrl: string | null): boolean {
  const pinned = policyServerUrl();
  if (!serverUrl || !pinned || lockedBool("server.allowOther") !== false) return true;
  return sameServer(serverUrl, pinned);
}

export function serverMove(): ((url: string | null) => string | null) | null {
  const pinned = policyServerUrl();
  const previous = (lockedList("server.previousUrls") ?? []).filter((u): u is string => typeof u === "string");
  if (!pinned || previous.length === 0) return null;
  return (url) => (previous.some((old) => sameServer(url, old)) ? pinned : null);
}
