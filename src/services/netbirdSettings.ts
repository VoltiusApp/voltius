import type { Connection, NetbirdSettings } from "@/types";

export const NETBIRD_DEFAULTS: NetbirdSettings = {
  issuer: "",
  client_id: "",
  scope: "openid profile email",
  audience: "",
  token_type: "access_token",
  fingerprint: "",
};

const issuerRe = /^https:\/\/[^@/?#\s]+(\/[^?#\s]*)?$/;
const fingerprintRe = /^SHA256:[A-Za-z0-9+/]{43}$/;

/** `ssh-keygen -l` style, without base64 padding, whatever prefix case or padding was pasted. */
export function normalizeFingerprint(value: string): string {
  const body = value.trim().replace(/^sha256:/i, "").replace(/=+$/, "");
  return body ? `SHA256:${body}` : "";
}

export function normalizeNetbird(settings: NetbirdSettings): NetbirdSettings {
  return {
    issuer: settings.issuer.trim(),
    client_id: settings.client_id.trim(),
    scope: settings.scope.trim(),
    audience: settings.audience.trim(),
    token_type: settings.token_type,
    fingerprint: normalizeFingerprint(settings.fingerprint),
  };
}

export function netbirdComplete(settings: NetbirdSettings): boolean {
  return issuerRe.test(settings.issuer) && !!settings.client_id && fingerprintRe.test(settings.fingerprint);
}

const LEGACY_PREFIX = "netbird-ssh:";

function readLegacy(key: string): NetbirdSettings | null {
  const saved = JSON.parse(localStorage.getItem(key) ?? "null");
  if (!saved || typeof saved !== "object") return null;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const settings = normalizeNetbird({
    issuer: text(saved.issuer),
    client_id: text(saved.clientId),
    scope: text(saved.scope),
    audience: text(saved.audience),
    token_type: saved.tokenType === "id_token" ? "id_token" : "access_token",
    fingerprint: text(saved.fingerprint),
  });
  return netbirdComplete(settings) ? settings : null;
}

/** Moves settings an earlier build kept in this browser onto their host, then forgets them. */
export async function migrateLegacyNetbird(
  connections: Connection[],
  save: (connection: Connection, netbird: NetbirdSettings) => Promise<void>,
): Promise<void> {
  let keys: string[];
  try {
    keys = Object.keys(localStorage).filter((key) => key.startsWith(LEGACY_PREFIX));
  } catch {
    return;
  }
  for (const key of keys) {
    const connection = connections.find((c) => c.id === key.slice(LEGACY_PREFIX.length));
    if (!connection) continue;
    try {
      const legacy = readLegacy(key);
      if (legacy && !connection.netbird) await save(connection, legacy);
      localStorage.removeItem(key);
    } catch { /* kept for the next load */ }
  }
}
