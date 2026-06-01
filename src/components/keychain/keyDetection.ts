// ─────────────────────────────────────────────────────────────────
// SSH key detection
// ─────────────────────────────────────────────────────────────────

export const PUB_TYPE_MAP: Record<string, string> = {
  "ssh-ed25519": "ED25519",
  "ssh-rsa": "RSA",
  "ecdsa-sha2-nistp256": "ECDSA P-256",
  "ecdsa-sha2-nistp384": "ECDSA P-384",
  "ecdsa-sha2-nistp521": "ECDSA P-521",
  "ssh-dss": "DSA",
};

export function detectKeyInfo(
  privateKey: string,
  publicKey: string,
): { type: string | null; valid: boolean; error?: string } {
  const pk = privateKey.trim();
  if (!pk) return { type: null, valid: true };

  const pemTypes: [string, string, string][] = [
    ["-----BEGIN RSA PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----", "RSA"],
    ["-----BEGIN EC PRIVATE KEY-----", "-----END EC PRIVATE KEY-----", "ECDSA"],
    ["-----BEGIN DSA PRIVATE KEY-----", "-----END DSA PRIVATE KEY-----", "DSA"],
    ["-----BEGIN PRIVATE KEY-----", "-----END PRIVATE KEY-----", "PKCS8"],
  ];
  for (const [header, footer, type] of pemTypes) {
    if (pk.startsWith(header)) {
      return { type, valid: pk.includes(footer) };
    }
  }

  if (pk.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----")) {
    if (!pk.includes("-----END OPENSSH PRIVATE KEY-----")) {
      return { type: null, valid: false, error: "Incomplete key" };
    }

    const pub = publicKey.trim();
    for (const [prefix, type] of Object.entries(PUB_TYPE_MAP)) {
      if (pub.startsWith(prefix)) return { type, valid: true };
    }

    try {
      const b64 = pk
        .replace("-----BEGIN OPENSSH PRIVATE KEY-----", "")
        .replace("-----END OPENSSH PRIVATE KEY-----", "")
        .replace(/\s/g, "");
      const bin = atob(b64);

      const magic = "openssh-key-v1\0";
      if (!bin.startsWith(magic)) return { type: "OpenSSH", valid: true };

      const u32 = (p: number) =>
        (((bin.charCodeAt(p) << 24) | (bin.charCodeAt(p + 1) << 16) |
          (bin.charCodeAt(p + 2) << 8) | bin.charCodeAt(p + 3)) >>> 0);
      const skipStr = (p: number) => p + 4 + u32(p);

      let pos = magic.length;
      pos = skipStr(pos); // cipher
      pos = skipStr(pos); // kdf
      pos = skipStr(pos); // kdf options
      pos += 4;           // num keys

      pos += 4;           // skip pubkey block length
      const typeLen = u32(pos);
      pos += 4;
      const keyType = bin.slice(pos, pos + typeLen);

      return { type: PUB_TYPE_MAP[keyType] ?? keyType, valid: true };
    } catch {
      return { type: "OpenSSH", valid: true };
    }
  }

  return { type: null, valid: false, error: "Unrecognized key format" };
}
