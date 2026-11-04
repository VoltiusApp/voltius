import { adminDefault, lockedValue } from "@/stores/policyStore";
import { DEFAULT_SERVER_URL, instanceLabel, storedServerUrl } from "@/utils/serverInstance";

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export function policyServerUrl(): string | null {
  const lock = lockedValue("server.url");
  return lock.locked && typeof lock.value === "string" ? trimSlash(lock.value) : null;
}

export function initialServerUrl(last: string): string {
  const fallback = adminDefault("server.url");
  return policyServerUrl() ?? (last || (typeof fallback === "string" ? fallback : last));
}

export const startingServerUrl = (): string => initialServerUrl(storedServerUrl()) || DEFAULT_SERVER_URL;

export function resolveServerUrl(input: string): string {
  return policyServerUrl() ?? trimSlash(input);
}

export class ServerBlockedError extends Error {
  constructor() {
    super("Account server is not allowed by policy");
  }
}

export function serverAllowed(serverUrl: string | null): boolean {
  const pinned = policyServerUrl();
  const other = lockedValue("server.allowOther");
  if (!serverUrl || !pinned || !other.locked || other.value !== false) return true;
  return instanceLabel(serverUrl) === instanceLabel(pinned);
}
