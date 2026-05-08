// formats.ts — pure data: interfaces, JSON/CSV serialization, format detection.
// No business logic, no store imports, no eid building. See registry.ts for that.

import type { ConnectionFormData } from "@/types";

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
  _folder_eid?: string;
}

export interface IdentityExport {
  _eid?: string;
  name?: string;
  username: string;
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
    throw new Error("Invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || (parsed as ExportBundle).version !== 1) {
    throw new Error("Not a Voltius export bundle (expected { version: 1, ... })");
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

// ─── CSV (connections only) ───────────────────────────────────────────────────

const CSV_HEADERS = ["name", "host", "port", "username", "auth_type", "tags"];

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function connectionsToCSV(connections: ConnectionExport[]): string {
  const rows: string[][] = [CSV_HEADERS];
  for (const c of connections) {
    rows.push([c.name ?? "", c.host ?? "", String(c.port ?? 0), c.username ?? "", c.auth_type ?? "", c.tags.join(";")]);
  }
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { result.push(""); break; }
    if (line[i] === '"') {
      let value = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { value += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { value += line[i++]; }
      }
      result.push(value);
      if (line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) { result.push(line.slice(i)); break; }
      result.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return result;
}

export function connectionsFromCSV(text: string): ConnectionExport[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]).map((h) => h.toLowerCase().trim());
  const col = (name: string) => headers.indexOf(name);

  const hostIdx = col("host") >= 0 ? col("host") : col("hostname");
  const usernameIdx = col("username") >= 0 ? col("username") : col("user");
  if (hostIdx === -1 || usernameIdx === -1) {
    throw new Error("CSV must have at least 'host' and 'username' columns");
  }

  const connections: ConnectionExport[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    const host = row[hostIdx]?.trim();
    const username = row[usernameIdx]?.trim();
    if (!host || !username) continue;
    connections.push({
      name: col("name") >= 0 ? row[col("name")]?.trim() || undefined : undefined,
      host,
      port: col("port") >= 0 ? parseInt(row[col("port")], 10) || 22 : 22,
      username,
      auth_type: (col("auth_type") >= 0 && row[col("auth_type")]?.trim() === "key") ? "key" : "password",
      tags: col("tags") >= 0 && row[col("tags")]?.trim()
        ? row[col("tags")].trim().split(";").map((t) => t.trim()).filter(Boolean)
        : [],
    });
  }
  return connections;
}

// ─── Auto-detection ───────────────────────────────────────────────────────────

export function detectFormat(text: string): "json" | "csv" | null {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  const firstLine = t.split("\n")[0].toLowerCase();
  if (firstLine.includes("host") || firstLine.includes("username") || firstLine.includes("user")) return "csv";
  return null;
}
