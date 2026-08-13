import type { ResolvedCredentials } from "@/services/credentialLogic";

/**
 * Auth the user typed into the connect overlay for a quick-connect (unsaved)
 * host. Quick-connect never writes to the vault, so without this every path
 * that re-resolves credentials by connection id — duplicate, manual reconnect,
 * auto-reconnect backoff — would dial with no password and fail. Held in memory
 * only (never the keychain), dropped when the last session on that connection
 * id closes or when the host is saved for real.
 */
const ephemeralCredentials = new Map<string, ResolvedCredentials>();

export function setEphemeralCredentials(connectionId: string, credentials: ResolvedCredentials): void {
  ephemeralCredentials.set(connectionId, credentials);
}

export function clearEphemeralCredentials(connectionId: string): void {
  ephemeralCredentials.delete(connectionId);
}

/**
 * Layer cached quick-connect auth under what the vault resolved. Stored secrets
 * win, so a saved host is never affected — for an ephemeral id there are none.
 */
export function withEphemeralCredentials(
  connectionId: string,
  resolved: ResolvedCredentials,
): ResolvedCredentials {
  const cached = ephemeralCredentials.get(connectionId);
  if (!cached) return resolved;
  return {
    // The overlay username is the one that actually authenticated; the ephemeral
    // record still holds whatever was typed in the quick-connect box.
    username: cached.username || resolved.username,
    password: resolved.password ?? cached.password,
    privateKey: resolved.privateKey ?? cached.privateKey,
    passphrase: resolved.passphrase ?? cached.passphrase,
  };
}
