// Pure types, JSON serialization, encryption, and format detection.
// Format-specific parsers live in parsers/*.ts — one file per format.

import type { ConnectionFormData } from "@/types";
import i18n from "@/i18n";
import { decryptXChaCha20Poly1305, encryptXChaCha20Poly1305 } from "../crypto/xchacha.ts";

// ─── Shared types ─────────────────────────────────────────────────────────────
// _eid fields are export-scoped IDs used only within a bundle for cross-referencing.
// They are never stored in the vault and are stripped on import after resolution.

export interface FolderExport {
  _eid: string;
  name: string;
  object_type: string;
  parent_folder_eid?: string;
}

export interface KeyExport {
  _eid?: string;
  name?: string;
  key_type?: string;
  tags?: string[];
  private_key?: string;
  public_key?: string;
  passphrase?: string;
  _folder_eid?: string;
}

export interface IdentityExport {
  _eid?: string;
  name?: string;
  username: string;
  password?: string;
  tags?: string[];
  _key_eid?: string;    // → KeyExport._eid in the same bundle
  _folder_eid?: string;
}

export interface JumpHostExport {
  id: string;
  host: string;
  port: number;
  username: string;
  identity_id?: string;     // kept for reading old exports that lack _identity_eid
  _identity_eid?: string;   // → IdentityExport._eid in the same bundle
  _connection_eid?: string; // → ConnectionExport._eid in the same bundle
}

// identity_id/folder_id/vault_id/jump_hosts are replaced by _eid cross-refs; everything else passes through.
type ConnectionPassthrough = Omit<ConnectionFormData, "identity_id" | "folder_id" | "vault_id" | "jump_hosts">;

export interface ConnectionExport extends ConnectionPassthrough {
  _eid?: string;        // → referenced by PortForwardingRuleExport._connection_eids
  password?: string;
  private_key?: string;
  passphrase?: string;
  _key_eid?: string;      // → KeyExport._eid in the same bundle
  _identity_eid?: string; // → IdentityExport._eid in the same bundle
  _folder_eid?: string;
  jump_hosts?: JumpHostExport[];
}

export interface SnippetExport {
  _eid?: string;
  name: string;
  content: string;
  description?: string;
  tags: string[];
  favorite: boolean;
  only_for_connection_tags: string[];
  only_for_distros: string[];
  _folder_eid?: string;
}

export interface PortForwardingRuleExport {
  _eid?: string;
  name: string;
  local_port: number;
  remote_port: number;
  remote_host: string;
  tunnel_type?: string;
  bind_host?: string;
  target_host?: string;
  description?: string;
  _connection_eids: string[]; // → ConnectionExport._eid in the same bundle
  _folder_eid?: string;
}

export interface ExportBundle {
  version: 1;
  exported_at: string;
  folders: FolderExport[];
  connections: ConnectionExport[];
  identities: IdentityExport[];
  keys: KeyExport[];
  snippets: SnippetExport[];
  portForwardingRules: PortForwardingRuleExport[];
}

// ─── JSON ─────────────────────────────────────────────────────────────────────

export function toJSON(bundle: ExportBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function fromJSON(text: string): ExportBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(i18n.t("common.error.invalidJson"));
  }
  if (typeof parsed !== "object" || parsed === null || (parsed as ExportBundle).version !== 1) {
    throw new Error(i18n.t("common.error.notVoltiusExportBundle"));
  }
  const b = parsed as ExportBundle;
  return {
    version: 1,
    exported_at: b.exported_at ?? new Date().toISOString(),
    folders: Array.isArray(b.folders) ? b.folders : [],
    connections: Array.isArray(b.connections) ? b.connections : [],
    identities: Array.isArray(b.identities) ? b.identities : [],
    keys: Array.isArray(b.keys) ? b.keys : [],
    snippets: Array.isArray(b.snippets) ? b.snippets : [],
    portForwardingRules: Array.isArray(b.portForwardingRules) ? b.portForwardingRules : [],
  };
}

// ─── Encrypted bundle (XChaCha20-Poly1305, PBKDF2 key derivation) ─────────────

interface EncryptedBundleFile {
  type: "voltius-encrypted";
  version: 2;
  cipher: "xchacha20poly1305";
  salt: string; // base64, 16 bytes
  nonce: string; // base64, 24 bytes
  data: string; // base64 ciphertext
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    raw,
    256,
  );
  return new Uint8Array(bits);
}

export async function encryptText(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16)) as Uint8Array<ArrayBuffer>;
  const key = await deriveKey(password, salt);
  const encrypted = encryptXChaCha20Poly1305(key, new TextEncoder().encode(plaintext));
  const file: EncryptedBundleFile = {
    type: "voltius-encrypted",
    version: 2,
    cipher: "xchacha20poly1305",
    salt: bytesToB64(salt),
    nonce: bytesToB64(encrypted.nonce),
    data: bytesToB64(encrypted.ciphertext),
  };
  return JSON.stringify(file, null, 2);
}

export async function decryptText(text: string, password: string): Promise<string> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error(i18n.t("common.error.invalidEncryptedFile")); }
  const obj = parsed as EncryptedBundleFile;
  if (obj?.type !== "voltius-encrypted") throw new Error(i18n.t("common.error.notEncryptedVoltiusBackup"));
  if (obj.version !== 2 || obj.cipher !== "xchacha20poly1305") throw new Error(i18n.t("common.error.unsupportedEncryptedBackup"));
  const key = await deriveKey(password, b64ToBytes(obj.salt));
  let decrypted: Uint8Array;
  try {
    decrypted = decryptXChaCha20Poly1305(key, b64ToBytes(obj.nonce), b64ToBytes(obj.data));
  } catch {
    throw new Error(i18n.t("common.error.wrongPasswordOrCorrupted"));
  }
  return new TextDecoder().decode(decrypted);
}

// ─── Format detection ──────────────────────────────────────────────────────────

export function detectFormat(text: string): "json" | "csv" | "mobaxterm" | "termius" | "voltius-encrypted" | null {
  const t = text.trim();
  if (t.startsWith("{")) {
    if (/"type"\s*:\s*"voltius-encrypted"/.test(t.slice(0, 120))) return "voltius-encrypted";
    if (/"records"\s*:/.test(t.slice(0, 300)) && /"version"\s*:\s*[12]/.test(t.slice(0, 300))) return "termius";
    return "json";
  }
  if (t.startsWith("[") && /#\d+#/.test(t)) return "mobaxterm";
  // Termius dumps are JSON arrays of strings; each string is an escaped JSON object
  // containing Termius-specific field names like `connection_type` / `user_name`.
  if (t.startsWith("[") && /\\"(?:connection_type|user_name)\\"/.test(t)) return "termius";
  if (t.startsWith("[")) return "json";
  const firstLine = t.split("\n")[0].toLowerCase();
  if (firstLine.includes("host") || firstLine.includes("username") || firstLine.includes("user")) return "csv";
  return null;
}
