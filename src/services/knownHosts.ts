import { invoke } from "@/lib/invoke";
import type { TFunction } from "i18next";
import type { KnownHost } from "@/types";

/** Mirror `TLS_PIN_PREFIX` and `TLS_WEBPKI_MARKER` in src-tauri/src/tls.rs. */
export const TLS_PIN_PREFIX = "tls-sha256:";
export const TLS_WEBPKI_MARKER = "tls-webpki";

export function isTlsPin(fingerprint: string): boolean {
  return fingerprint.startsWith(TLS_PIN_PREFIX) || fingerprint === TLS_WEBPKI_MARKER;
}

/** The CA marker holds no digest, so it is shown by name. */
export function fingerprintLabel(fingerprint: string, t: TFunction, truncate: (fp: string) => string): string {
  return fingerprint === TLS_WEBPKI_MARKER ? t("knownHosts.caVerified") : truncate(fingerprint);
}

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

/** Aborts a connect's certificate prompt, even one it has not reached yet. */
export async function cancelKnownHostPrompt(sessionId: string): Promise<void> {
  return invoke("known_host_cancel", { sessionId });
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
