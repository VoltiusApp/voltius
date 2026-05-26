import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionExport,
  ExportBundle,
  IdentityExport,
  JumpHostExport,
  KeyExport,
  PortForwardingRuleExport,
  SnippetExport,
} from "../formats";

// Termius stores its data in Chromium IndexedDB. The Rust extractor
// (`termius_extract` Tauri command) walks the leveldb, decodes the V8
// Structured-Clone envelope, decrypts every per-field encrypted blob with
// XSalsa20-Poly1305, and returns one TermiusRecord per IndexedDB row. Each
// record carries:
//   - db_name           : which Termius store ("hosts", "ssh_identities", …)
//   - termius_id        : primary key
//   - foreign_keys      : envelope nested-object FKs (ssh_config, group, …)
//   - foreign_key_arrays: array FKs (host_chains.hosts_chain → [host_id, …])
//   - decrypted         : merged body (envelope plaintext + decrypted blobs)
//
// We classify by `db_name` and resolve relations across the graph:
//   host ──(ssh_config.id)──► sshConfig  (1:1)
//   host ──(group.id)──► group
//   ssh_config_identity (ssh_config.id, identity.id)  — host↔identity bridge
//   ssh_identity ──(ssh_key.id, when is_visible:false)──► ssh_key
//   host_chains (ssh_config.id → [host_id, …])  — jump hosts
//   pf_rules (host.id)  — port forwarding rules per host

// ─── Rust-side record shape (Tauri command output) ────────────────────────────

interface TermiusRecord {
  db_name: string;
  termius_id: number;
  local_id?: number;
  updated_at?: string;
  status?: string;
  foreign_keys?: Record<string, number>;
  foreign_key_arrays?: Record<string, number[]>;
  decrypted: Record<string, unknown>;
}

interface TermiusSnapshot {
  version: 2;
  records: TermiusRecord[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function parseEnvVars(raw?: string): { id: string; key: string; value: string }[] {
  if (!raw || raw === "{}") return [];
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(obj).map(([key, value]) => ({
      id: crypto.randomUUID(),
      key,
      value: String(value),
    }));
  } catch {
    return [];
  }
}

function tunnelTypeOf(pfType?: string): "local" | "remote" | "dynamic" {
  const t = (pfType ?? "").toLowerCase();
  if (t.startsWith("remote")) return "remote";
  if (t.startsWith("dynamic")) return "dynamic";
  return "local";
}

// ─── Index by db_name + id ────────────────────────────────────────────────────

interface Indexed {
  hosts: Map<number, TermiusRecord>;
  sshConfigs: Map<number, TermiusRecord>;
  sshConfigSettings: Map<number, TermiusRecord>; // settings sibling (env_vars, port, agent_forwarding)
  groups: Map<number, TermiusRecord>;
  sshIdentities: Map<number, TermiusRecord>;
  identitySettings: Map<number, TermiusRecord>; // settings sibling for identities
  sshKeys: Map<number, TermiusRecord>;
  sshKeyAuth: Map<number, TermiusRecord>; // username/password sibling of a key
  sshConfigIdentities: TermiusRecord[];
  hostChains: TermiusRecord[];
  pfRules: TermiusRecord[];
  snippets: TermiusRecord[];
  hostSnippets: TermiusRecord[];
  tags: Map<number, TermiusRecord>;
  tagHosts: TermiusRecord[];
}

function indexRecords(records: TermiusRecord[]): Indexed {
  const out: Indexed = {
    hosts: new Map(),
    sshConfigs: new Map(),
    sshConfigSettings: new Map(),
    groups: new Map(),
    sshIdentities: new Map(),
    identitySettings: new Map(),
    sshKeys: new Map(),
    sshKeyAuth: new Map(),
    sshConfigIdentities: [],
    hostChains: [],
    pfRules: [],
    snippets: [],
    hostSnippets: [],
    tags: new Map(),
    tagHosts: [],
  };
  for (const r of records) {
    switch (r.db_name) {
      case "hosts": out.hosts.set(r.termius_id, r); break;
      case "ssh_configs": out.sshConfigs.set(r.termius_id, r); break;
      case "settings": out.sshConfigSettings.set(r.termius_id, r); break;
      case "groups": out.groups.set(r.termius_id, r); break;
      case "ssh_identities": out.sshIdentities.set(r.termius_id, r); break;
      case "ssh_config_identities": out.sshConfigIdentities.push(r); break;
      case "keys": out.sshKeys.set(r.termius_id, r); break;
      case "host_chains": out.hostChains.push(r); break;
      case "pf_rules": out.pfRules.push(r); break;
      case "snippets": out.snippets.push(r); break;
      case "host_snippets": out.hostSnippets.push(r); break;
      case "tags": out.tags.set(r.termius_id, r); break;
      case "tag_hosts": out.tagHosts.push(r); break;
    }
  }
  return out;
}

// ─── Bundle builder ───────────────────────────────────────────────────────────

export function bundleFromTermius(text: string): ExportBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Termius dump must be valid JSON");
  }
  if (Array.isArray(raw)) {
    throw new Error("Legacy Termius dump format is no longer supported; use Auto Extract.");
  }
  const snapshot = raw as Partial<TermiusSnapshot>;
  if (snapshot?.version !== 2 || !Array.isArray(snapshot.records)) {
    throw new Error("Termius extraction must return { version: 2, records: [...] }");
  }

  const idx = indexRecords(snapshot.records);

  // ─── Keys ────────────────────────────────────────────────────────────────
  const keysOut: KeyExport[] = [];
  const keyEidByTermiusId = new Map<number, string>();
  for (const k of idx.sshKeys.values()) {
    const label = str(k.decrypted.label);
    const privateKey = str(k.decrypted.private_key);
    if (!privateKey) continue; // key with no private material — skip
    const eid = `tk${keysOut.length}`;
    keyEidByTermiusId.set(k.termius_id, eid);
    keysOut.push({
      _eid: eid,
      name: label,
      private_key: privateKey,
      public_key: str(k.decrypted.public_key),
      passphrase: str(k.decrypted.passphrase),
      tags: [],
    });
  }

  // ─── Folders (Termius groups) ────────────────────────────────────────────
  // Each group maps to a Voltius folder; folder hierarchy via group's
  // `parent_group` foreign key.
  const folderEidByGroupId = new Map<number, string>();
  const foldersOut = Array.from(idx.groups.values()).map((g, i) => {
    const eid = `tf${i}`;
    folderEidByGroupId.set(g.termius_id, eid);
    return { eid, group: g };
  }).map(({ eid, group }) => ({
    _eid: eid,
    name: str(group.decrypted.label) ?? `Group ${group.termius_id}`,
    object_type: "connection",
    parent_folder_eid: group.foreign_keys?.parent_group != null
      ? folderEidByGroupId.get(group.foreign_keys.parent_group)
      : undefined,
  }));

  // ─── Identity resolution ─────────────────────────────────────────────────
  // For each host (via ssh_config.id), find the bound ssh_identity, then walk
  // identity → ssh_key (when is_visible:false) or use the identity directly
  // (when is_visible:true).
  const identityBySshConfigId = new Map<number, TermiusRecord>();
  for (const rel of idx.sshConfigIdentities) {
    const sshConfigId = rel.foreign_keys?.ssh_config;
    const identityId = rel.foreign_keys?.identity;
    if (sshConfigId == null || identityId == null) continue;
    const identity = idx.sshIdentities.get(identityId);
    if (identity) identityBySshConfigId.set(sshConfigId, identity);
  }

  // ─── Identities (only visible ones become Voltius Identity rows) ─────────
  const identitiesOut: IdentityExport[] = [];
  const identityEidByTermiusId = new Map<number, string>();
  const pushIdentity = (termiusId: number, identity: Omit<IdentityExport, "_eid" | "tags"> & { tags?: string[] }) => {
    if (identityEidByTermiusId.has(termiusId)) return;
    const eid = `ti${identitiesOut.length}`;
    identityEidByTermiusId.set(termiusId, eid);
    identitiesOut.push({
      _eid: eid,
      tags: [],
      ...identity,
    });
  };

  for (const auth of idx.sshKeys.values()) {
    if (!bool(auth.decrypted.is_visible)) continue;
    const username = str(auth.decrypted.username) ?? "";
    const password = str(auth.decrypted.password);
    if (!username || !password) continue;
    pushIdentity(auth.termius_id, {
      name: str(auth.decrypted.label) ?? username,
      username,
      password,
    });
  }

  for (const identity of idx.sshIdentities.values()) {
    if (!bool(identity.decrypted.is_visible)) continue; // invisible identities are inlined into connections
    const linkedAuth = identity.foreign_keys?.ssh_key != null ? idx.sshKeys.get(identity.foreign_keys.ssh_key) : undefined;
    const username = str(identity.decrypted.username) ?? str(linkedAuth?.decrypted.username) ?? "";
    if (!username) continue;
    const keyId = linkedAuth && str(linkedAuth.decrypted.private_key) ? linkedAuth.termius_id : undefined;
    pushIdentity(identity.termius_id, {
      name: str(identity.decrypted.label) ?? username,
      username,
      password: str(identity.decrypted.password) ?? str(linkedAuth?.decrypted.password),
      _key_eid: keyId != null ? keyEidByTermiusId.get(keyId) : undefined,
    });
  }

  // ─── Host chains (jump hosts) ────────────────────────────────────────────
  // Termius stores jump host chains in host_chains: { ssh_config: <id>,
  // hosts_chain: [host_id, ...] }. Each host_id in the chain references a
  // host (not a sshConfig). We need to map back: host_id → ssh_config_id.
  const sshConfigIdByHostPrimaryId = new Map<number, number>();
  for (const host of idx.hosts.values()) {
    const sshConfigId = host.foreign_keys?.ssh_config;
    if (sshConfigId != null) sshConfigIdByHostPrimaryId.set(host.termius_id, sshConfigId);
  }
  // Map ssh_config_id → list of host_ids (in jump order, host[0] is the first
  // jump, the host whose ssh_config matched is the final target).
  const chainBySshConfigId = new Map<number, number[]>();
  for (const chain of idx.hostChains) {
    const sshConfigId = chain.foreign_keys?.ssh_config ?? num(chain.decrypted.ssh_config);
    const hops = (chain.foreign_key_arrays?.hosts_chain ?? []).filter(id => id > 0);
    if (sshConfigId != null && hops.length > 0) {
      chainBySshConfigId.set(sshConfigId, hops);
    }
  }

  // ─── Connections (one per host) ──────────────────────────────────────────
  const connectionsOut: ConnectionExport[] = [];
  const connectionEidByHostId = new Map<number, string>();

  for (const host of idx.hosts.values()) {
    if (host.status && host.status.toLowerCase() === "deleted") continue;
    connectionEidByHostId.set(host.termius_id, `tc${connectionEidByHostId.size}`);
  }

  for (const host of idx.hosts.values()) {
    if (host.status && host.status.toLowerCase() === "deleted") continue;
    const sshConfigId = host.foreign_keys?.ssh_config;
    const sshConfig = sshConfigId != null ? idx.sshConfigs.get(sshConfigId) : undefined;
    // Settings live in the `settings` collection (id-matched to ssh_config).
    const settings = sshConfigId != null ? idx.sshConfigSettings.get(sshConfigId) : undefined;
    const settingsBody = settings?.decrypted ?? sshConfig?.decrypted ?? {};

    const address = str(host.decrypted.address) ?? "";
    const label = str(host.decrypted.label) ?? address;
    const port = num(settingsBody.port) ?? 22;
    const envVars = parseEnvVars(str(settingsBody.env_variables));
    const agentForwarding = bool(settingsBody.agent_forwarding);
    const charset = str(settingsBody.charset);
    const startupCommand = str(settingsBody.startup_command);
    const distro = str(host.decrypted.os_name);

    // Resolve credentials via ssh_config_identities.
    let authType: "key" | "password" = "password";
    let username = "";
    let password: string | undefined;
    let privateKey: string | undefined;
    let identityEid: string | undefined;
    let keyEid: string | undefined;

    if (sshConfigId != null) {
      const identity = identityBySshConfigId.get(sshConfigId);
      if (identity) {
        const idBody = identity.decrypted;
        const keyTermiusId = identity.foreign_keys?.ssh_key;
        const linkedKey = keyTermiusId != null ? idx.sshKeys.get(keyTermiusId) : undefined;
        const idUsername = str(idBody.username) ?? str(linkedKey?.decrypted.username) ?? "";
        const idPassword = str(idBody.password) ?? str(linkedKey?.decrypted.password);
        const isVisible = bool(idBody.is_visible) === true;

        username = idUsername;
        if (linkedKey && str(linkedKey.decrypted.private_key)) {
          authType = "key";
          privateKey = str(linkedKey.decrypted.private_key);
          keyEid = keyEidByTermiusId.get(linkedKey.termius_id);
        } else if (idPassword) {
          authType = "password";
          password = idPassword;
        }
        if (isVisible) {
          identityEid = identityEidByTermiusId.get(identity.termius_id);
        }
      }
    }

    // Build jump hosts. Chain is stored on the TARGET ssh_config; the
    // hosts_chain array lists intermediate hosts in order.
    const hops = sshConfigId != null ? chainBySshConfigId.get(sshConfigId) ?? [] : [];
    const jumpHosts: JumpHostExport[] | undefined = hops.length > 0
      ? hops.map(hopHostId => {
          const hopHost = idx.hosts.get(hopHostId);
          const hopSshConfigId = hopHost?.foreign_keys?.ssh_config;
          const hopSettings = hopSshConfigId != null ? idx.sshConfigSettings.get(hopSshConfigId) : undefined;
          const hopIdentity = hopSshConfigId != null ? identityBySshConfigId.get(hopSshConfigId) : undefined;
          return {
            id: crypto.randomUUID(),
            host: str(hopHost?.decrypted.address) ?? "",
            port: num(hopSettings?.decrypted.port ?? hopHost?.decrypted.port) ?? 22,
            username: str(hopIdentity?.decrypted.username) ?? "",
            _connection_eid: connectionEidByHostId.get(hopHostId),
            _identity_eid: hopIdentity && bool(hopIdentity.decrypted.is_visible)
              ? identityEidByTermiusId.get(hopIdentity.termius_id)
              : undefined,
          };
        })
      : undefined;

    // Folder via group FK on host.
    const groupId = host.foreign_keys?.group;
    const folderEid = groupId != null ? folderEidByGroupId.get(groupId) : undefined;

    const eid = connectionEidByHostId.get(host.termius_id) ?? `tc${connectionsOut.length}`;
    connectionsOut.push({
      _eid: eid,
      name: label,
      host: address,
      port,
      username,
      auth_type: authType,
      password,
      private_key: privateKey,
      _key_eid: keyEid,
      _identity_eid: identityEid,
      _folder_eid: folderEid,
      tags: [],
      connection_type: "ssh",
      ...(envVars.length && { env_vars: envVars }),
      ...(distro && { distro }),
      ...(charset && { terminal_encoding: charset }),
      ...(startupCommand && { pre_command: startupCommand }),
      ...(agentForwarding != null && { agent_forwarding: agentForwarding }),
      ...(jumpHosts && { jump_hosts: jumpHosts }),
    });
  }

  // ─── Snippets ────────────────────────────────────────────────────────────
  const snippetsOut: SnippetExport[] = idx.snippets.map((s, i) => ({
    _eid: `ts${i}`,
    name: str(s.decrypted.label) ?? `Snippet ${s.termius_id}`,
    content: str(s.decrypted.script) ?? "",
    tags: [],
    favorite: false,
    only_for_connection_tags: [],
    only_for_distros: [],
  }));

  // ─── Port forwarding rules ───────────────────────────────────────────────
  const pfOut: PortForwardingRuleExport[] = idx.pfRules.map((rule, i) => {
    const pfType = str(rule.decrypted.pf_type) ?? "Local Rule";
    const hostId = rule.foreign_keys?.host;
    const connEid = hostId != null ? connectionEidByHostId.get(hostId) : undefined;
    return {
      _eid: `tp${i}`,
      name: str(rule.decrypted.label) ?? `${pfType} :${num(rule.decrypted.local_port) ?? 0}`,
      local_port: num(rule.decrypted.local_port) ?? 0,
      remote_port: num(rule.decrypted.remote_port) ?? num(rule.decrypted.local_port) ?? 0,
      remote_host: str(rule.decrypted.hostname) ?? "",
      tunnel_type: tunnelTypeOf(pfType),
      bind_host: str(rule.decrypted.bound_address) ?? "127.0.0.1",
      target_host: str(rule.decrypted.hostname) ?? "",
      _connection_eids: connEid ? [connEid] : [],
    };
  });

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    folders: foldersOut,
    connections: connectionsOut,
    identities: identitiesOut,
    keys: keysOut,
    snippets: snippetsOut,
    portForwardingRules: pfOut,
  };
}

/** One-step extraction: decrypt the local Termius DB and return an ExportBundle. */
export async function extractTermiusBundle(): Promise<ExportBundle> {
  const snapshot = await invoke<TermiusSnapshot>("termius_extract");
  return bundleFromTermius(JSON.stringify(snapshot));
}
