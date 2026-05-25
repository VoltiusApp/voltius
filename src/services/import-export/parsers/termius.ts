import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionExport,
  ExportBundle,
  IdentityExport,
  KeyExport,
  SnippetExport,
} from "../formats";

// Termius stores entities encrypted in a local LevelDB. There is no first-party
// export, so the `termius_extract` Tauri command reads the leveldb files,
// fetches the master key from the OS keychain, and decrypts each blob with
// XSalsa20-Poly1305. The blob shapes themselves are inferred (Termius does not
// document them); the original reverse-engineering credit goes to
// github.com/ZacharyZcR/termius-exporter.
//
// `bundleFromTermius` parses already-decrypted input (a JSON array of blob
// strings) — useful for testing and for users who run extraction elsewhere.
// `extractTermiusBundle` is the one-step path the UI uses.

interface TermiusIdentity {
  id?: string;
  label?: string;
  username: string;
  password?: string;
}

interface TermiusKey {
  id?: string;
  label: string;
  private_key: string;
  public_key?: string;
  passphrase?: string;
}

interface TermiusConnection {
  id?: string;
  title?: string;
  host: string;
  port?: number;
  user_name: string;
  connection_type: string;
  key_id?: string;
  host_os_name?: string;
}

interface TermiusSnippet {
  id?: string;
  label: string;
  script: string;
}

interface Parsed {
  identities: TermiusIdentity[];
  keys: TermiusKey[];
  connections: TermiusConnection[];
  snippets: TermiusSnippet[];
}

function classify(blobs: string[]): Parsed {
  const out: Parsed = { identities: [], keys: [], connections: [], snippets: [] };
  for (const blob of blobs) {
    if (!blob.startsWith("{")) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(blob); } catch { continue; }

    if (typeof obj.private_key === "string" && typeof obj.label === "string") {
      out.keys.push(obj as unknown as TermiusKey);
    } else if (typeof obj.host === "string" && typeof obj.user_name === "string" && typeof obj.connection_type === "string") {
      out.connections.push(obj as unknown as TermiusConnection);
    } else if (typeof obj.username === "string" && "password" in obj) {
      out.identities.push(obj as unknown as TermiusIdentity);
    } else if (typeof obj.script === "string" && typeof obj.label === "string") {
      out.snippets.push(obj as unknown as TermiusSnippet);
    }
  }
  return out;
}

// connection.key_id references a key entity's primary id. We try a direct lookup
// first; if Termius's surrogate ids are missing from the decrypted blobs we fall
// back to the original tool's frequency-sort pairing (most-referenced key_id ↔
// first-listed key label), which works when there's only a handful of keys.
function makeKeyResolver(keys: TermiusKey[], connections: TermiusConnection[]) {
  const byId = new Map<string, TermiusKey>();
  for (const k of keys) if (k.id) byId.set(k.id, k);

  const usage = new Map<string, number>();
  for (const c of connections) {
    if (c.key_id) usage.set(c.key_id, (usage.get(c.key_id) ?? 0) + 1);
  }
  const fallbackOrder = [...usage.keys()].sort((a, b) => usage.get(b)! - usage.get(a)!);
  const fallbackKeys = keys.filter(k => !k.id || !byId.has(k.id));

  return (keyId: string): TermiusKey | undefined => {
    const direct = byId.get(keyId);
    if (direct) return direct;
    const idx = fallbackOrder.indexOf(keyId);
    return idx >= 0 ? fallbackKeys[idx] : undefined;
  };
}

function findPasswordIdentity(identities: TermiusIdentity[], username: string): TermiusIdentity | undefined {
  for (const id of identities) if (id.username === username && id.password) return id;
  return undefined;
}

export function bundleFromTermius(text: string): ExportBundle {
  let blobs: unknown;
  try { blobs = JSON.parse(text); }
  catch { throw new Error("Termius dump must be valid JSON"); }
  if (!Array.isArray(blobs) || !blobs.every(b => typeof b === "string")) {
    throw new Error("Termius dump must be a JSON array of decrypted blob strings");
  }

  const parsed = classify(blobs as string[]);
  const resolveKey = makeKeyResolver(parsed.keys, parsed.connections);

  // ─── Keys ─────────────────────────────────────────────────────────────
  const keysOut: KeyExport[] = [];
  const keyEidByLabel = new Map<string, string>();
  parsed.keys.forEach((k, i) => {
    const eid = `tk${i}`;
    keyEidByLabel.set(k.label, eid);
    keysOut.push({
      _eid: eid,
      name: k.label,
      private_key: k.private_key,
      public_key: k.public_key,
      tags: ["termius"],
    });
  });

  // ─── Identities ───────────────────────────────────────────────────────
  // One identity per (username, linked-key) pair so SSH-key and password
  // logins for the same account stay distinct.
  const identitiesOut: IdentityExport[] = [];
  const identityEidByPair = new Map<string, string>();
  const ensureIdentity = (username: string, keyLabel?: string): string => {
    const dedupe = `${username}\x00${keyLabel ?? ""}`;
    const cached = identityEidByPair.get(dedupe);
    if (cached) return cached;
    const eid = `ti${identitiesOut.length}`;
    identityEidByPair.set(dedupe, eid);
    identitiesOut.push({
      _eid: eid,
      name: keyLabel ? `${username} · ${keyLabel}` : username,
      username,
      _key_eid: keyLabel ? keyEidByLabel.get(keyLabel) : undefined,
      tags: ["termius"],
    });
    return eid;
  };

  // ─── Connections ──────────────────────────────────────────────────────
  const connectionsOut: ConnectionExport[] = [];
  const seen = new Set<string>();
  for (const c of parsed.connections) {
    if (c.connection_type !== "ssh") continue;
    const port = c.port ?? 22;
    const sig = `${c.host}:${port}:${c.user_name}`;
    if (seen.has(sig)) continue;
    seen.add(sig);

    const matchedKey = c.key_id ? resolveKey(c.key_id) : undefined;
    const useKey = !!matchedKey;
    const passwordIdentity = useKey ? undefined : findPasswordIdentity(parsed.identities, c.user_name);
    const identityEid = ensureIdentity(c.user_name, matchedKey?.label);

    const tags = ["termius"];
    if (c.host_os_name) tags.push(c.host_os_name.toLowerCase());

    connectionsOut.push({
      name: c.title || `${c.user_name}@${c.host}`,
      host: c.host,
      port,
      username: c.user_name,
      auth_type: useKey ? "key" : "password",
      password: passwordIdentity?.password,
      tags,
      connection_type: "ssh",
      _identity_eid: identityEid,
    });
  }

  // ─── Snippets ─────────────────────────────────────────────────────────
  const snippetsOut: SnippetExport[] = parsed.snippets.map((s, i) => ({
    _eid: `ts${i}`,
    name: s.label,
    content: s.script,
    tags: ["termius"],
    favorite: false,
    only_for_connection_tags: [],
    only_for_distros: [],
  }));

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    folders: [],
    connections: connectionsOut,
    identities: identitiesOut,
    keys: keysOut,
    snippets: snippetsOut,
    portForwardingRules: [],
  };
}

/** One-step extraction: decrypt the local Termius DB and return an ExportBundle. */
export async function extractTermiusBundle(): Promise<ExportBundle> {
  const blobs = await invoke<string[]>("termius_extract");
  return bundleFromTermius(JSON.stringify(blobs));
}
