import { invoke } from "@tauri-apps/api/core";
import type { ConnectionExport, ExportBundle, IdentityExport } from "../formats";

// INI file format. Each [Bookmarks_N] section has SubRep=FolderName, then
// session lines: Name=#TYPE#flags%field1%field2%... SSH is type 109.
// SSH fields: [0]=flags [1]=host [2]=port [3]=username [4]=auth (3=key, else password)
const MOBAXTERM_SSH_TYPE = 109;

export function connectionsFromMobaXterm(text: string): ConnectionExport[] {
  const connections: ConnectionExport[] = [];
  let currentFolder: string | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.startsWith("[") && line.endsWith("]")) {
      currentFolder = undefined;
      continue;
    }

    if (line.startsWith("SubRep=")) {
      const folder = line.slice(7).trim().replace(/\\/g, "/");
      currentFolder = folder || undefined;
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const name = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim();

    const typeMatch = value.match(/^#(\d+)#/);
    if (!typeMatch) continue;
    if (parseInt(typeMatch[1], 10) !== MOBAXTERM_SSH_TYPE) continue;

    const fields = value.slice(typeMatch[0].length).split("%");
    // fields[0]=flags, [1]=host, [2]=port, [3]=username, [4]=auth
    const host = fields[1]?.trim();
    const port = parseInt(fields[2] ?? "22", 10) || 22;
    const username = fields[3]?.trim();
    if (!host || !username) continue;

    const auth_type: "key" | "password" = fields[4]?.trim() === "3" ? "key" : "password";

    connections.push({
      name,
      host,
      port,
      username,
      auth_type,
      tags: currentFolder ? [currentFolder] : [],
    });
  }

  return connections;
}

// ─── Live extraction (Windows, MobaXterm ≥25/v26) ───────────────────────────────
// The `mobaxterm_extract` Tauri command reads HKCU\Software\Mobatek\MobaXterm,
// derives the AES key via DPAPI (no master password needed), decrypts the P
// (session passwords) and C (saved credentials) subkeys, and reconstructs the
// bookmark sections into INI text. Session structure is parsed here (one source
// of truth) and enriched with the decrypted passwords.

interface MobaCredential {
  name: string;
  username: string;
  password: string;
}

interface MobaSnapshot {
  /** Bookmark sections as INI text (reconstructed from the registry, or the
   *  MobaXterm.ini file for the Portable edition). Null if neither was found. */
  ini: string | null;
  /** P subkey: decrypted session passwords keyed by their registry value name
   *  (MobaXterm uses `username@host`). */
  passwords: Record<string, string>;
  /** C subkey: decrypted saved credentials. */
  credentials: MobaCredential[];
  /** False when DPAPI key derivation failed — sessions still import, passwordless. */
  key_derived: boolean;
}

export async function extractMobaXtermBundle(): Promise<ExportBundle> {
  const snap = await invoke<MobaSnapshot>("mobaxterm_extract");

  const connections = snap.ini ? connectionsFromMobaXterm(snap.ini) : [];
  // Attach decrypted passwords. MobaXterm keys P-subkey entries by `username@host`.
  for (const c of connections) {
    if (c.auth_type !== "password") continue;
    const pw = snap.passwords[`${c.username}@${c.host}`];
    if (pw) c.password = pw;
  }

  const identities: IdentityExport[] = snap.credentials.map((cr) => ({
    name: cr.name,
    username: cr.username,
    password: cr.password,
  }));

  return {
    version: 1,
    exported_at: "",
    folders: [],
    connections,
    identities,
    keys: [],
    snippets: [],
    portForwardingRules: [],
  };
}
