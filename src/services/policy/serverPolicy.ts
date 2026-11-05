import { adminDefault, lockedBool, lockedString } from "@/stores/policyStore";
import { DEFAULT_SERVER_URL, instanceLabel, normalizeServerUrl, storedServerUrl } from "@/utils/serverInstance";

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
  return instanceLabel(serverUrl) === instanceLabel(pinned);
}
