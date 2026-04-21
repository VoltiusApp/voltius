import React, { useEffect, useState } from "react";
import type { PluginAPI, PluginConnectionInput, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import type { JumpHost } from "@/types";

// ─── Manifest ────────────────────────────────────────────────────────────────

export const manifest: PluginManifest = {
  id: "plugin-ssh-config",
  name: "SSH Config Sync",
  version: "1.0.0",
  description: "Auto-syncs hosts from ~/.ssh/config. Connections are tagged 'ssh-config'.",
  permissions: [
    "connections:read", "connections:write",
    "keys:read", "keys:write",
    "identities:read", "identities:write",
    "fs", "settings-page",
  ],
  defaultEnabled: true,
};

// ─── SSH config parser ────────────────────────────────────────────────────────

interface SshHost {
  alias: string;
  hostname: string;
  user: string;
  port: number;
  identityFile?: string;
  proxyJump?: string; // raw ProxyJump value (e.g. "bastion" or "user@host:22,host2")
}

function parseSshConfig(content: string): SshHost[] {
  const hosts: SshHost[] = [];
  let current: Partial<SshHost> | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const spaceIdx = line.search(/\s/);
    if (spaceIdx === -1) continue;

    const key = line.slice(0, spaceIdx).toLowerCase();
    const value = line.slice(spaceIdx).trim();

    if (key === "host") {
      // Flush previous
      if (current?.hostname && current?.user) {
        hosts.push(current as SshHost);
      }
      // Skip wildcards and patterns
      if (value.includes("*") || value.includes("?") || value.includes("!")) {
        current = null;
      } else {
        current = { alias: value, port: 22 };
      }
    } else if (current) {
      switch (key) {
        case "hostname":     current.hostname = value; break;
        case "user":         current.user = value; break;
        case "port":         current.port = parseInt(value, 10) || 22; break;
        case "identityfile": current.identityFile = value; break;
        case "proxyjump":    current.proxyJump = value; break;
      }
    }
  }

  // Flush last
  if (current?.hostname && current?.user) {
    hosts.push(current as SshHost);
  }

  return hosts;
}

// ─── ProxyJump helpers ───────────────────────────────────────────────────────

/** Parse a single ProxyJump hop: "alias", "user@host", or "user@host:port". */
function parseProxyJumpHop(hop: string): { user?: string; host: string; port: number } {
  const trimmed = hop.trim();
  let rest = trimmed;
  let user: string | undefined;
  if (rest.includes("@")) {
    const at = rest.indexOf("@");
    user = rest.slice(0, at);
    rest = rest.slice(at + 1);
  }
  let host = rest;
  let port = 22;
  const colon = rest.lastIndexOf(":");
  if (colon > 0) {
    host = rest.slice(0, colon);
    port = parseInt(rest.slice(colon + 1), 10) || 22;
  }
  return { user, host, port };
}

// ─── Sync logic ───────────────────────────────────────────────────────────────

const SSH_CONFIG_TAG = "ssh-config";
const SSH_CONFIG_PATH = "~/.ssh/config";
const ALIAS_MAP_KEY = "alias_map";
// keyPath → key id (so we reuse the same key entry for shared IdentityFile paths)
const KEY_MAP_KEY = "key_map";
// alias → identity id
const IDENTITY_MAP_KEY = "identity_map";

type AliasMap = Record<string, string>;
type KeyMap = Record<string, string>;
type IdentityMap = Record<string, string>;

/** Resolve an IdentityFile path to the tilde-prefixed form the fs API accepts. */
function normalizePath(p: string): string {
  if (p.startsWith("~/") || p === "~") return p;
  if (p.startsWith("/")) return p;
  // Windows absolute path (e.g. C:\... or C:/...)
  if (/^[A-Za-z]:[/\\]/.test(p)) return p;
  return `~/.ssh/${p}`;
}

/**
 * Ensure a key entry exists for the given identity file path.
 * Reads the private key (and .pub if present), creates the key once and reuses it.
 * Returns the key id, or null if the file can't be read.
 */
async function ensureKey(
  api: PluginAPI,
  keyPath: string,
  keyMap: KeyMap,
): Promise<string | null> {
  if (keyMap[keyPath]) return keyMap[keyPath];

  const privPath = normalizePath(keyPath);
  const pubPath = `${privPath}.pub`;

  const exists = await api.fs.exists(privPath);
  if (!exists) return null;

  let privateKey: string;
  try {
    privateKey = await api.fs.readText(privPath);
  } catch {
    return null;
  }

  let publicKey: string | undefined;
  try {
    if (await api.fs.exists(pubPath)) {
      publicKey = await api.fs.readText(pubPath);
    }
  } catch { /* optional */ }

  // Derive a display name from the filename (handle both / and \ separators)
  const name = privPath.split(/[/\\]/).pop() ?? keyPath;

  const key = await api.keys.create({ name }, privateKey, publicKey);
  keyMap[keyPath] = key.id;
  return key.id;
}

async function sync(api: PluginAPI): Promise<void> {
  const exists = await api.fs.exists(SSH_CONFIG_PATH);
  if (!exists) return;

  const content = await api.fs.readText(SSH_CONFIG_PATH);
  const hosts = parseSshConfig(content);

  const allConnections = await api.connections.list();
  const taggedConnections = allConnections.filter((c) =>
    c.tags.includes(SSH_CONFIG_TAG),
  );

  const aliasMap: AliasMap = (await api.storage.get<AliasMap>(ALIAS_MAP_KEY)) ?? {};
  const keyMap: KeyMap = (await api.storage.get<KeyMap>(KEY_MAP_KEY)) ?? {};
  const identityMap: IdentityMap = (await api.storage.get<IdentityMap>(IDENTITY_MAP_KEY)) ?? {};

  // Hosts present in the config file (keyed by alias)
  const configAliases = new Set(hosts.map((h) => h.alias));

  // ── Remove connections whose alias disappeared from the config ──────────
  const toDelete: string[] = [];
  for (const [alias, connId] of Object.entries(aliasMap)) {
    if (!configAliases.has(alias)) {
      const still = taggedConnections.find((c) => c.id === connId);
      if (still) toDelete.push(connId);
      delete aliasMap[alias];
      // Clean up associated identity (key is shared so we keep it)
      const identityId = identityMap[alias];
      if (identityId) {
        await api.identities.delete(identityId).catch(() => {});
        delete identityMap[alias];
      }
    }
  }
  for (const id of toDelete) {
    await api.connections.delete(id).catch(() => {});
  }

  // ── Add/update connections for each host in the config ──────────────────
  for (const host of hosts) {
    // Resolve identity: create key + identity if IdentityFile is set
    let identityId: string | undefined;
    if (host.identityFile) {
      const keyId = await ensureKey(api, host.identityFile, keyMap);
      if (keyId) {
        // Reuse existing identity for this alias, or create one
        if (identityMap[host.alias]) {
          identityId = identityMap[host.alias];
        } else {
          const identity = await api.identities.create({
            name: host.alias,
            username: host.user,
            key_id: keyId,
          });
          identityId = identity.id;
          identityMap[host.alias] = identityId;
        }
      }
    }

    const existingId = aliasMap[host.alias];
    const existing = existingId
      ? taggedConnections.find((c) => c.id === existingId)
      : taggedConnections.find(
          (c) =>
            c.host === host.hostname &&
            c.port === host.port &&
            c.username === host.user,
        );

    // Rebuild aliasMap entry if found via fallback (e.g. storage was cleared)
    if (!existingId && existing) {
      aliasMap[host.alias] = existing.id;
    }

    const data: PluginConnectionInput = {
      name: host.alias !== host.hostname ? host.alias : undefined,
      host: host.hostname,
      port: host.port,
      username: host.user,
      auth_type: identityId ? "key" : "password",
      tags: [SSH_CONFIG_TAG],
      identity_id: identityId,
    };

    if (!existing) {
      const conn = await api.connections.create(data);
      aliasMap[host.alias] = conn.id;
    } else {
      const changed =
        existing.host !== data.host ||
        existing.port !== data.port ||
        existing.username !== data.username ||
        existing.auth_type !== data.auth_type ||
        existing.identity_id !== data.identity_id ||
        (data.name !== undefined && existing.name !== data.name);

      if (changed) {
        await api.connections.update(existing.id, data);
      }
    }
  }

  await api.storage.set(ALIAS_MAP_KEY, aliasMap);
  await api.storage.set(KEY_MAP_KEY, keyMap);
  await api.storage.set(IDENTITY_MAP_KEY, identityMap);

  // ── Second pass: resolve ProxyJump → jump_hosts ──────────────────────────
  // aliasMap is now fully populated, so we can resolve alias references.
  const allConnectionsNow = await api.connections.list();
  for (const host of hosts) {
    if (!host.proxyJump) continue;
    const connId = aliasMap[host.alias];
    if (!connId) continue;

    const hops = host.proxyJump.split(",").map((h) => h.trim()).filter(Boolean);
    const jumpHosts: JumpHost[] = [];

    for (const hop of hops) {
      const parsed = parseProxyJumpHop(hop);
      // Try to match by alias first, then by hostname
      const refConnId = aliasMap[parsed.host];
      const refConn = refConnId
        ? allConnectionsNow.find((c) => c.id === refConnId)
        : allConnectionsNow.find((c) => c.host === parsed.host && c.port === parsed.port);

      if (refConn) {
        jumpHosts.push({
          id: `ssh-cfg-${connId}-${refConn.id}`,
          connection_id: refConn.id,
          host: refConn.host,
          port: refConn.port,
          username: parsed.user ?? refConn.username,
          identity_id: refConn.identity_id,
        });
      } else {
        // Referenced host not in saved connections — skip this hop
        api.log.info(`ProxyJump: host "${parsed.host}" not found in saved connections, skipping`);
      }
    }

    const existingConn = allConnectionsNow.find((c) => c.id === connId);
    const existingJumps = existingConn?.jump_hosts ?? [];
    const jumpIds = jumpHosts.map((j) => j.connection_id).join(",");
    const existingIds = existingJumps.map((j) => j.connection_id).join(",");
    if (jumpIds !== existingIds) {
      await api.connections.update(connId, { jump_hosts: jumpHosts });
    }
  }

  api.log.info(`Synced ${hosts.length} host(s) from ~/.ssh/config`);
}

// ─── Settings ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_KEY = "poll_interval_ms";
const DEFAULT_POLL_INTERVAL = 5000;
const RESTART_EVENT = "ssh-config:restart-watcher";

function createSettingsComponent(api: PluginAPI): React.FC {
  return function SshConfigSettings() {
    const [intervalMs, setIntervalMs] = useState<number>(DEFAULT_POLL_INTERVAL);

    useEffect(() => {
      api.storage.get<number>(POLL_INTERVAL_KEY).then((v) => {
        if (v != null) setIntervalMs(v);
      });
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = Math.max(1, Number(e.target.value)) * 1000;
      setIntervalMs(next);
      void api.storage.set(POLL_INTERVAL_KEY, next);
      api.events.emit(RESTART_EVENT, next);
    };

    return React.createElement(
      "div",
      { className: "space-y-5" },
      React.createElement(
        "div",
        null,
        React.createElement(
          "h3",
          {
            className: "text-xs font-bold uppercase tracking-widest mb-3",
            style: { color: "var(--t-text-dim)" },
          },
          "Sync"
        ),
        React.createElement(
          "div",
          {
            className: "rounded-xl p-4",
            style: { background: "var(--t-bg-card)", border: "1px solid var(--t-border)" },
          },
          React.createElement(
            "div",
            { className: "flex items-center justify-between" },
            React.createElement(
              "div",
              null,
              React.createElement(
                "p",
                { className: "text-sm font-medium", style: { color: "var(--t-text-primary)" } },
                "Poll interval"
              ),
              React.createElement(
                "p",
                { className: "text-xs mt-0.5", style: { color: "var(--t-text-dim)" } },
                "How often to check ~/.ssh/config for changes"
              )
            ),
            React.createElement(
              "div",
              { className: "flex items-center gap-2" },
              React.createElement("input", {
                type: "number",
                min: 1,
                max: 3600,
                value: intervalMs / 1000,
                onChange: handleChange,
                className: "w-20 text-sm text-center rounded-lg px-2 py-1.5",
                style: {
                  background: "var(--t-bg-elevated)",
                  border: "1px solid var(--t-border)",
                  color: "var(--t-text-primary)",
                  outline: "none",
                },
              }),
              React.createElement(
                "span",
                { className: "text-xs", style: { color: "var(--t-text-dim)" } },
                "seconds"
              )
            )
          )
        )
      )
    );
  };
}

// ─── Register ─────────────────────────────────────────────────────────────────

export const register: PluginRegisterFn = (api) => {
  let stopWatch: (() => void) | null = null;

  const startWatcher = (intervalMs: number) => {
    stopWatch?.();
    stopWatch = api.fs.watch(
      SSH_CONFIG_PATH,
      () => {
        api.log.info("~/.ssh/config changed — resyncing");
        sync(api).catch((e) => api.log.error("ssh-config sync failed", e));
      },
      { intervalMs },
    );
  };

  // Initial sync on load
  sync(api).catch((e) => api.log.error("Initial ssh-config sync failed", e));

  // Start watcher with stored or default interval
  api.storage.get<number>(POLL_INTERVAL_KEY).then((stored) => {
    startWatcher(stored ?? DEFAULT_POLL_INTERVAL);
  });

  // Restart watcher when interval changes from settings
  const offEvent = api.events.on(RESTART_EVENT, (data) => {
    const newInterval = typeof data === "number" ? data : DEFAULT_POLL_INTERVAL;
    api.log.info(`Poll interval changed to ${newInterval}ms`);
    startWatcher(newInterval);
  });

  // Register settings page
  const unregisterSettings = api.ui.registerSettingsPage({
    id: `${manifest.id}:settings`,
    label: "SSH Config Sync",
    icon: "lucide:file-code",
    component: createSettingsComponent(api),
  });

  return () => {
    stopWatch?.();
    offEvent();
    unregisterSettings();
  };
};
