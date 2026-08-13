import { invoke } from "@tauri-apps/api/core";
import type { KnownHost } from "@/types";

export async function listKnownHosts(): Promise<KnownHost[]> {
  return invoke("known_host_list");
}

export async function deleteKnownHost(id: string): Promise<void> {
  return invoke("known_host_delete", { id });
}

export async function moveKnownHostVault(id: string, vaultId: string): Promise<void> {
  return invoke("known_host_move_vault", { id, vaultId });
}

export async function copyKnownHostVault(id: string, vaultId: string): Promise<KnownHost> {
  return invoke("known_host_copy_vault", { id, vaultId });
}

export async function resolveKnownHostConflict(
  sessionId: string,
  action: "add_new" | "replace" | "abort",
): Promise<void> {
  return invoke("known_host_resolve", { sessionId, action });
}

export interface TrustOutcome {
  entry: KnownHost;
  superseded: KnownHost[];
}

export async function trustKnownHost(input: {
  host: string;
  port: number;
  fingerprint: string;
  vaultId?: string;
  replace?: boolean;
}): Promise<TrustOutcome> {
  return invoke("known_host_trust", {
    host: input.host,
    port: input.port,
    fingerprint: input.fingerprint,
    vaultId: input.vaultId,
    replace: input.replace,
  });
}
