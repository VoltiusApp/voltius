/**
 * Pure serialization seams for team vault sync: base64 byte helpers and the
 * blob's `files` map build/parse. No IO, no crypto — safe to unit test directly.
 */

export interface TeamVaultSlices {
  connections: unknown[];
  identities: unknown[];
  keys: unknown[];
  folders: unknown[];
  snippets: unknown[];
  snippetFolders: unknown[];
  portForwardingRules: unknown[];
}

export function bytesToBase64(bytes: number[]): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.slice(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): number[] {
  const binary = atob(b64);
  const out = new Array<number>(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function parseTeamVaultFile<T>(json: string | undefined): T[] {
  try {
    return JSON.parse(json ?? "[]");
  } catch {
    return [];
  }
}

/** Serialize in-memory team slices into the blob's `files` map. */
export function buildTeamVaultFiles(slices: TeamVaultSlices): Record<string, string> {
  return {
    "connections.json": JSON.stringify(slices.connections),
    "identities.json": JSON.stringify(slices.identities),
    "ssh_keys.json": JSON.stringify(slices.keys),
    "folders.json": JSON.stringify(slices.folders),
    "snippets.json": JSON.stringify(slices.snippets),
    "snippet_folders.json": JSON.stringify(slices.snippetFolders),
    "port_forwarding_rules.json": JSON.stringify(slices.portForwardingRules),
  };
}

/** Parse a decrypted blob's `files` map back into team slices. */
export function parseTeamVaultBlobFiles(files: Record<string, string>): TeamVaultSlices {
  return {
    connections: parseTeamVaultFile(files["connections.json"]),
    identities: parseTeamVaultFile(files["identities.json"]),
    keys: parseTeamVaultFile(files["ssh_keys.json"]),
    folders: parseTeamVaultFile(files["folders.json"]),
    snippets: parseTeamVaultFile(files["snippets.json"]),
    snippetFolders: parseTeamVaultFile(files["snippet_folders.json"]),
    portForwardingRules: parseTeamVaultFile(files["port_forwarding_rules.json"]),
  };
}
