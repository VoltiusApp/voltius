/**
 * Pure serialization seams for team vault sync: base64 byte helpers and the
 * blob's `files` map build/parse. No IO, no crypto — safe to unit test directly.
 */

import { base64ToBytes as decodeBase64 } from "@/utils/base64";

export { bytesToBase64 } from "@/utils/base64";

export interface TeamVaultSlices {
  connections: unknown[];
  identities: unknown[];
  keys: unknown[];
  folders: unknown[];
  snippets: unknown[];
  snippetFolders: unknown[];
  portForwardingRules: unknown[];
}

// Tauri commands take `Vec<u8>` as a JSON number array, which a Uint8Array
// does not serialize to.
export function base64ToBytes(b64: string): number[] {
  return Array.from(decodeBase64(b64));
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
