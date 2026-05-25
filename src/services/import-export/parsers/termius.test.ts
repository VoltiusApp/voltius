import { bundleFromTermius } from "./termius.ts";

// Snapshot fixture shape matches what the Rust extractor returns:
//   { version: 2, records: [{ db_name, termius_id, foreign_keys?, foreign_key_arrays?, decrypted, … }] }

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

function snapshot(records: TermiusRecord[]): string {
  return JSON.stringify({ version: 2, records });
}

function host(id: number, sshConfigId: number, label: string, address: string, opts: Partial<TermiusRecord> = {}): TermiusRecord {
  return {
    db_name: "hosts",
    termius_id: id,
    foreign_keys: { ssh_config: sshConfigId, ...(opts.foreign_keys ?? {}) },
    decrypted: {
      label,
      address,
      os_name: "ubuntu",
      backspace: "default",
      ip_version: "AUTO",
    },
    ...opts,
  };
}

function sshConfig(id: number): TermiusRecord {
  return { db_name: "ssh_configs", termius_id: id, decrypted: {} };
}

function settings(sshConfigId: number, body: Record<string, unknown>): TermiusRecord {
  return { db_name: "settings", termius_id: sshConfigId, decrypted: body };
}

function group(id: number, label: string, parentId?: number): TermiusRecord {
  return {
    db_name: "groups",
    termius_id: id,
    foreign_keys: parentId != null ? { parent_group: parentId } : {},
    decrypted: { label },
  };
}

function key(id: number, label: string): TermiusRecord {
  return {
    db_name: "keys",
    termius_id: id,
    decrypted: {
      label,
      private_key: `-----BEGIN OPENSSH PRIVATE KEY-----\n${label}\n-----END OPENSSH PRIVATE KEY-----`,
      public_key: `ssh-ed25519 ${label}`,
      passphrase: "",
    },
  };
}

function identity(id: number, username: string, opts: { visible?: boolean; password?: string; keyId?: number; label?: string } = {}): TermiusRecord {
  const fk: Record<string, number> = {};
  if (opts.keyId != null) fk.ssh_key = opts.keyId;
  return {
    db_name: "ssh_identities",
    termius_id: id,
    foreign_keys: fk,
    decrypted: {
      username,
      label: opts.label ?? "",
      password: opts.password ?? "",
      is_visible: opts.visible ?? false,
    },
  };
}

function bindIdentity(sshConfigId: number, identityId: number): TermiusRecord {
  return {
    db_name: "ssh_config_identities",
    termius_id: sshConfigId,
    foreign_keys: { ssh_config: sshConfigId, identity: identityId },
    decrypted: {},
  };
}

function hostChain(sshConfigId: number, hopHostIds: number[]): TermiusRecord {
  return {
    db_name: "host_chains",
    termius_id: sshConfigId,
    foreign_keys: { ssh_config: sshConfigId },
    foreign_key_arrays: { hosts_chain: hopHostIds },
    decrypted: {},
  };
}

function pfRule(id: number, hostId: number, body: Record<string, unknown>): TermiusRecord {
  return {
    db_name: "pf_rules",
    termius_id: id,
    foreign_keys: { host: hostId },
    decrypted: body,
  };
}

function snippet(id: number, label: string, script: string): TermiusRecord {
  return {
    db_name: "snippets",
    termius_id: id,
    decrypted: { label, script },
  };
}

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function assertEqual<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(actual)} to deep-equal ${JSON.stringify(expected)}`);
  }
}

// ─── Core: end-to-end "Serv Maison Jump" scenario ─────────────────────────────

run("resolves host → identity → key linkage via ssh_config_identities", () => {
  // Mirrors the user's real data: host 'Serv Maison Jump' uses an invisible
  // identity bound to the 'Serv Maison' key with username 'root'.
  const bundle = bundleFromTermius(snapshot([
    sshConfig(45672876),
    settings(45672876, { port: 22, env_variables: '{"FFA":"test"}', agent_forwarding: false }),
    host(45716684, 45672876, "Serv Maison Jump", "192.168.1.149"),
    key(2752454, "Serv Maison"),
    identity(28862881, "root", { visible: false, keyId: 2752454 }),
    bindIdentity(45672876, 28862881),
  ]));

  assertEqual(bundle.connections.length, 1);
  const conn = bundle.connections[0];
  assertEqual(conn?.name, "Serv Maison Jump");
  assertEqual(conn?.host, "192.168.1.149");
  assertEqual(conn?.username, "root");
  assertEqual(conn?.auth_type, "key");
  assertEqual(conn?._key_eid, bundle.keys[0]?._eid);
  // Inlined: invisible identity should NOT create a Voltius Identity row.
  assertEqual(bundle.identities.length, 0);
  assertEqual(conn?._identity_eid, undefined);
  // Settings flowed through.
  assertEqual(conn?.port, 22);
  assertDeepEqual(conn?.env_vars?.map(v => [v.key, v.value]), [["FFA", "test"]]);
  assertEqual(conn?.agent_forwarding, false);
});

run("creates a Voltius Identity row for visible password identities", () => {
  const bundle = bundleFromTermius(snapshot([
    sshConfig(100),
    host(101, 100, "Web Server", "10.0.0.1"),
    identity(700, "prod-user", { visible: true, password: "secret", label: "Prod" }),
    bindIdentity(100, 700),
  ]));

  assertEqual(bundle.identities.length, 1);
  assertEqual(bundle.identities[0]?.name, "Prod");
  assertEqual(bundle.identities[0]?.username, "prod-user");
  const conn = bundle.connections[0];
  assertEqual(conn?.auth_type, "password");
  assertEqual(conn?.password, "secret");
  assertEqual(conn?._identity_eid, bundle.identities[0]?._eid);
});

run("falls back to password when identity has no linked key", () => {
  const bundle = bundleFromTermius(snapshot([
    sshConfig(200),
    host(201, 200, "Misc", "10.0.0.2"),
    // Invisible identity, no ssh_key FK, with password.
    identity(800, "root", { visible: false, password: "rootpw" }),
    bindIdentity(200, 800),
  ]));

  assertEqual(bundle.connections[0]?.auth_type, "password");
  assertEqual(bundle.connections[0]?.password, "rootpw");
  assertEqual(bundle.connections[0]?.username, "root");
});

run("imports hosts even when no identity is bound (manual fixup case)", () => {
  const bundle = bundleFromTermius(snapshot([
    sshConfig(300),
    host(301, 300, "Lonely", "10.0.0.3"),
  ]));

  assertEqual(bundle.connections.length, 1);
  assertEqual(bundle.connections[0]?.host, "10.0.0.3");
  assertEqual(bundle.connections[0]?.username, "");
  assertEqual(bundle.connections[0]?.auth_type, "password");
  assertEqual(bundle.connections[0]?.password, undefined);
});

// ─── Groups → Folders ─────────────────────────────────────────────────────────

run("maps groups to folders with parent hierarchy", () => {
  const bundle = bundleFromTermius(snapshot([
    group(1, "Production"),
    group(2, "Webservers", 1),
    sshConfig(100),
    host(101, 100, "web1", "10.0.0.10", { foreign_keys: { ssh_config: 100, group: 2 } }),
  ]));

  assertEqual(bundle.folders.length, 2);
  const webservers = bundle.folders.find(f => f.name === "Webservers");
  const production = bundle.folders.find(f => f.name === "Production");
  assertEqual(webservers?.parent_folder_eid, production?._eid);
  assertEqual(bundle.connections[0]?._folder_eid, webservers?._eid);
});

// ─── Jump hosts ───────────────────────────────────────────────────────────────

run("emits jump_hosts from host_chains records", () => {
  const bundle = bundleFromTermius(snapshot([
    sshConfig(100),
    sshConfig(200),
    host(101, 100, "bastion", "10.0.0.99"),
    host(201, 200, "target", "10.0.0.50"),
    key(500, "k"),
    identity(700, "ubuntu", { visible: false, keyId: 500 }),
    bindIdentity(100, 700), // bastion creds
    bindIdentity(200, 700), // target creds
    hostChain(200, [101]), // target jumps through bastion (host id 101)
  ]));

  const target = bundle.connections.find(c => c.name === "target");
  const bastion = bundle.connections.find(c => c.name === "bastion");
  assertEqual(target?.jump_hosts?.length, 1);
  assertEqual(target?.jump_hosts?.[0].host, "10.0.0.99");
  assertEqual(target?.jump_hosts?.[0].username, "ubuntu");
  assertEqual(target?.jump_hosts?.[0]._connection_eid, bastion?._eid);
});

run("emits jump_hosts from actual Termius host_chains numeric fields", () => {
  const bundle = bundleFromTermius(snapshot([
    sshConfig(15442900),
    sshConfig(45672876),
    host(15442900, 15442900, "La Plexance", "89.168.41.244"),
    host(45716684, 45672876, "Serv Maison Jump", "192.168.1.149"),
    key(500, "k"),
    identity(700, "ubuntu", { visible: false, keyId: 500 }),
    bindIdentity(15442900, 700),
    bindIdentity(45672876, 700),
    {
      db_name: "host_chains",
      termius_id: 45672876,
      foreign_key_arrays: { hosts_chain: [0, 15442900] },
      decrypted: { ssh_config: 45672876 },
    },
  ]));

  const target = bundle.connections.find(c => c.name === "Serv Maison Jump");
  const jump = bundle.connections.find(c => c.name === "La Plexance");
  assertEqual(target?.jump_hosts?.length, 1);
  assertEqual(target?.jump_hosts?.[0].host, "89.168.41.244");
  assertEqual(target?.jump_hosts?.[0].username, "ubuntu");
  assertEqual(target?.jump_hosts?.[0]._connection_eid, jump?._eid);
});

// ─── Port forwarding ──────────────────────────────────────────────────────────

run("links port forwarding rules to their host's connection", () => {
  const bundle = bundleFromTermius(snapshot([
    sshConfig(100),
    host(101, 100, "h", "10.0.0.1"),
    pfRule(900, 101, {
      label: "Plex",
      bound_address: "127.0.0.1",
      hostname: "10.0.0.1",
      local_port: 32400,
      remote_port: 32400,
      pf_type: "Local Rule",
    }),
  ]));

  assertEqual(bundle.portForwardingRules.length, 1);
  const rule = bundle.portForwardingRules[0];
  assertEqual(rule?.tunnel_type, "local");
  assertEqual(rule?.local_port, 32400);
  assertEqual(rule?._connection_eids[0], bundle.connections[0]?._eid);
});

run("maps remote/dynamic pf_type to tunnel_type", () => {
  const bundle = bundleFromTermius(snapshot([
    pfRule(900, 0, { label: "R", bound_address: "0.0.0.0", local_port: 80, remote_port: 80, pf_type: "Remote Rule" }),
    pfRule(901, 0, { label: "D", bound_address: "127.0.0.1", local_port: 1080, pf_type: "Dynamic Rule" }),
  ]));

  assertEqual(bundle.portForwardingRules[0]?.tunnel_type, "remote");
  assertEqual(bundle.portForwardingRules[1]?.tunnel_type, "dynamic");
});

// ─── Snippets ─────────────────────────────────────────────────────────────────

run("imports snippets with name and content", () => {
  const bundle = bundleFromTermius(snapshot([
    snippet(1, "uptime", "uptime"),
    snippet(2, "logs", "tail -f /var/log/syslog"),
  ]));

  assertDeepEqual(bundle.snippets.map(s => s.name), ["uptime", "logs"]);
  assertEqual(bundle.snippets[0]?.content, "uptime");
});

// ─── Keys ─────────────────────────────────────────────────────────────────────

run("skips key records that have no private material", () => {
  const bundle = bundleFromTermius(snapshot([
    key(1, "real-key"),
    { db_name: "keys", termius_id: 2, decrypted: { label: "stub" } }, // no private_key
  ]));

  assertEqual(bundle.keys.length, 1);
  assertEqual(bundle.keys[0]?.name, "real-key");
});

// ─── Deleted entities ─────────────────────────────────────────────────────────

run("skips hosts whose status is deleted (defense in depth)", () => {
  // Rust extractor already filters inactive statuses, but be safe.
  const bundle = bundleFromTermius(snapshot([
    sshConfig(100),
    host(101, 100, "alive", "10.0.0.1"),
    host(102, 100, "dead", "10.0.0.2", { status: "deleted" }),
  ]));

  assertEqual(bundle.connections.length, 1);
  assertEqual(bundle.connections[0]?.name, "alive");
});
