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
    "fs", "settings-page", "notifications",
  ],
  defaultEnabled: true,
  desktopOnly: true,
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
      if (current?.hostname && current?.user) {
        hosts.push(current as SshHost);
      }
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
  allKeys: Awaited<ReturnType<typeof api.keys.list>>,
  notifyEnabled: boolean,
): Promise<string | null> {
  if (keyMap[keyPath]) {
    const stillExists = allKeys.find((k) => k.id === keyMap[keyPath]);
    if (stillExists) return keyMap[keyPath];
    delete keyMap[keyPath]; // stale — key was deleted externally
  }

  const privPath = normalizePath(keyPath);
  const pubPath = `${privPath}.pub`;
  const name = privPath.split(/[/\\]/).pop() ?? keyPath;

  // Fallback: reuse existing key by name if the map was lost/stale
  const existing = allKeys.find((k) => k.name === name);
  if (existing) {
    keyMap[keyPath] = existing.id;
    return existing.id;
  }

  const fileExists = await api.fs.exists(privPath);
  if (!fileExists) return null;

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

  const key = await api.keys.create({ name, tags: [SSH_CONFIG_TAG] }, privateKey, publicKey);
  keyMap[keyPath] = key.id;
  if (notifyEnabled) api.notifications.toast(`SSH key imported: ${name}`, { severity: "success", duration: 3000 });
  return key.id;
}

export async function sync(api: PluginAPI): Promise<void> {
  const exists = await api.fs.exists(SSH_CONFIG_PATH);
  if (!exists) return;

  const content = await api.fs.readText(SSH_CONFIG_PATH);
  const hosts = parseSshConfig(content);

  const [allConnections, allKeys, allIdentities] = await Promise.all([
    api.connections.list(),
    api.keys.list(),
    api.identities.list(),
  ]);
  const taggedConnections = allConnections.filter((c) =>
    c.tags.includes(SSH_CONFIG_TAG),
  );

  const aliasMap: AliasMap = (await api.storage.get<AliasMap>(ALIAS_MAP_KEY)) ?? {};
  const keyMap: KeyMap = (await api.storage.get<KeyMap>(KEY_MAP_KEY)) ?? {};
  const identityMap: IdentityMap = (await api.storage.get<IdentityMap>(IDENTITY_MAP_KEY)) ?? {};
  const notifyEnabled = (await api.storage.get<boolean>(NOTIFICATIONS_ENABLED_KEY)) ?? DEFAULT_NOTIFICATIONS_ENABLED;
  const adoptEnabled = (await api.storage.get<boolean>(ADOPT_UNTAGGED_ENABLED_KEY)) ?? DEFAULT_ADOPT_UNTAGGED_ENABLED;

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
    // Resolve the existing connection first — an adopted (untagged) match skips
    // key/identity work and preserves the user's fields, so the decision comes
    // before any key/identity creation.
    const existingId = aliasMap[host.alias];
    // aliasMap is authoritative: search ALL connections by id so a previously
    // adopted (untagged) connection is always re-found. The content fallback
    // stays scoped to tagged connections unless adoption is enabled.
    let existing =
      (existingId ? allConnections.find((c) => c.id === existingId) : undefined) ??
      taggedConnections.find(
        (c) =>
          c.host === host.hostname &&
          c.port === host.port &&
          c.username === host.user,
      );

    // Adoption: reuse an untagged user connection that matches by host/port/user
    // instead of creating a duplicate. First match wins.
    if (!existing && adoptEnabled) {
      existing = allConnections.find(
        (c) =>
          !c.tags.includes(SSH_CONFIG_TAG) &&
          c.host === host.hostname &&
          c.port === host.port &&
          c.username === host.user,
      );
    }

    // A managed connection that is untagged can only be an adopted one.
    const adopted = !!existing && !existing.tags.includes(SSH_CONFIG_TAG);

    if (existing) {
      aliasMap[host.alias] = existing.id;
    }

    // Adopted: preserve the user's fields; only propagate host/port/user changes.
    if (adopted && existing) {
      const changed =
        existing.host !== host.hostname ||
        existing.port !== host.port ||
        existing.username !== host.user;
      if (changed) {
        await api.connections.update(existing.id, {
          host: host.hostname,
          port: host.port,
          username: host.user,
        });
      }
      continue;
    }

    // Plugin-managed: ensure key/identity, then create or fully update.
    let identityId: string | undefined;
    if (host.identityFile) {
      const keyId = await ensureKey(api, host.identityFile, keyMap, allKeys, notifyEnabled);
      if (keyId) {
        if (identityMap[host.alias]) {
          const stillExists = allIdentities.find((i) => i.id === identityMap[host.alias]);
          if (stillExists) {
            identityId = identityMap[host.alias];
          } else {
            delete identityMap[host.alias]; // stale — identity was deleted externally
          }
        }
        if (!identityId) {
          const existingIdentity = allIdentities.find(
            (i) => i.name === host.alias && i.username === host.user && i.key_id === keyId,
          );
          if (existingIdentity) {
            identityId = existingIdentity.id;
            identityMap[host.alias] = identityId;
          } else {
            const identity = await api.identities.create({
              name: host.alias,
              username: host.user,
              key_id: keyId,
              tags: [SSH_CONFIG_TAG],
            });
            identityId = identity.id;
            identityMap[host.alias] = identityId;
            if (notifyEnabled) api.notifications.toast(`SSH identity created: ${host.alias}`, { severity: "success", duration: 3000 });
          }
        }
      }
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
      if (notifyEnabled) api.notifications.toast(`SSH host added: ${host.alias}`, { severity: "success", duration: 3000 });
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

    // Never overwrite jump_hosts on an adopted (untagged) user connection.
    const targetConn = allConnectionsNow.find((c) => c.id === connId);
    if (targetConn && !targetConn.tags.includes(SSH_CONFIG_TAG)) continue;

    const hops = host.proxyJump.split(",").map((h) => h.trim()).filter(Boolean);
    const jumpHosts: JumpHost[] = [];

    for (const hop of hops) {
      const parsed = parseProxyJumpHop(hop);
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
const NOTIFICATIONS_ENABLED_KEY = "notifications_enabled";
const DEFAULT_NOTIFICATIONS_ENABLED = true;
const ADOPT_UNTAGGED_ENABLED_KEY = "adopt_untagged_enabled";
const DEFAULT_ADOPT_UNTAGGED_ENABLED = true;
const RESTART_EVENT = "ssh-config:restart-watcher";
const SYNC_NOW_EVENT = "ssh-config:sync-now";

function createSettingsComponent(api: PluginAPI): React.FC {
  return function SshConfigSettings() {
    const [intervalMs, setIntervalMs] = useState<number>(DEFAULT_POLL_INTERVAL);
    const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(DEFAULT_NOTIFICATIONS_ENABLED);
    const [syncing, setSyncing] = useState(false);

    useEffect(() => {
      void Promise.all([
        api.storage.get<number>(POLL_INTERVAL_KEY),
        api.storage.get<boolean>(NOTIFICATIONS_ENABLED_KEY),
      ]).then(([interval, notify]) => {
        if (interval != null) setIntervalMs(interval);
        if (notify != null) setNotificationsEnabled(notify);
      });
    }, []);

    const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = Math.max(1, Number(e.target.value)) * 1000;
      setIntervalMs(next);
      void api.storage.set(POLL_INTERVAL_KEY, next);
      api.events.emit(RESTART_EVENT, next);
    };

    const handleNotificationsToggle = () => {
      const next = !notificationsEnabled;
      setNotificationsEnabled(next);
      void api.storage.set(NOTIFICATIONS_ENABLED_KEY, next);
    };

    const handleSyncNow = () => {
      setSyncing(true);
      api.events.emit(SYNC_NOW_EVENT);
      setTimeout(() => setSyncing(false), 1500);
    };

    const divider = React.createElement("div", {
      style: { borderTop: "1px solid var(--t-border)", margin: "12px -16px", padding: "0 16px" },
    });

    const cardStyle = { background: "var(--t-bg-card)", border: "1px solid var(--t-border)" };
    const labelStyle = { color: "var(--t-text-primary)" };
    const dimStyle = { color: "var(--t-text-dim)" };
    const inputStyle = {
      background: "var(--t-bg-elevated)",
      border: "1px solid var(--t-border)",
      color: "var(--t-text-primary)",
      outline: "none",
    };
    const toggleTrackStyle = {
      width: 36,
      height: 20,
      borderRadius: 10,
      background: notificationsEnabled ? "var(--t-accent)" : "var(--t-border)",
      position: "relative" as const,
      cursor: "pointer",
      transition: "background 0.15s",
      flexShrink: 0,
    };
    const toggleThumbStyle = {
      position: "absolute" as const,
      top: 2,
      left: notificationsEnabled ? 18 : 2,
      width: 16,
      height: 16,
      borderRadius: "50%",
      background: "white",
      transition: "left 0.15s",
    };
    const syncBtnStyle = {
      ...inputStyle,
      padding: "4px 12px",
      borderRadius: 8,
      fontSize: 12,
      cursor: syncing ? "default" : "pointer",
      opacity: syncing ? 0.6 : 1,
    };

    return React.createElement(
      "div",
      { className: "space-y-5" },
      React.createElement(
        "div",
        null,
        React.createElement(
          "h3",
          { className: "text-xs font-bold uppercase tracking-widest mb-3", style: dimStyle },
          "Sync"
        ),
        React.createElement(
          "div",
          { className: "rounded-xl p-4", style: cardStyle },
          React.createElement(
            "div",
            { className: "flex items-center justify-between" },
            React.createElement(
              "div",
              null,
              React.createElement("p", { className: "text-sm font-medium", style: labelStyle }, "Poll interval"),
              React.createElement(
                "p",
                { className: "text-xs mt-0.5", style: dimStyle },
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
                onChange: handleIntervalChange,
                className: "w-20 text-sm text-center rounded-lg px-2 py-1.5",
                style: inputStyle,
              }),
              React.createElement("span", { className: "text-xs", style: dimStyle }, "seconds"),
              React.createElement(
                "button",
                { onClick: handleSyncNow, disabled: syncing, style: syncBtnStyle },
                syncing ? "Syncing…" : "Sync now"
              )
            )
          ),
          divider,
          React.createElement(
            "div",
            { className: "flex items-center justify-between" },
            React.createElement(
              "div",
              null,
              React.createElement("p", { className: "text-sm font-medium", style: labelStyle }, "Notifications"),
              React.createElement(
                "p",
                { className: "text-xs mt-0.5", style: dimStyle },
                "Show a toast when hosts, keys, or identities are created"
              )
            ),
            React.createElement(
              "div",
              { style: toggleTrackStyle, onClick: handleNotificationsToggle },
              React.createElement("div", { style: toggleThumbStyle })
            )
          )
        )
      )
    );
  };
}

// ─── Register ─────────────────────────────────────────────────────────────────

export const register: PluginRegisterFn = (api) => {
  // Settings page is registered regardless of active state so a disabled
  // plugin can still be reviewed/configured before re-enabling. Kept out of the
  // active cleanup below so disabling never removes it (matches gist-sync).
  api.ui.registerSettingsPage({
    id: `${manifest.id}:settings`,
    label: "SSH Config Sync",
    icon: "lucide:file-code",
    component: createSettingsComponent(api),
  });

  // Everything below is active-only work. A disabled plugin must stay fully
  // inert — no file watcher, no auto-sync — until it is re-enabled, at which
  // point setPluginActive re-runs register() with isActive() === true.
  if (!api.isActive()) return () => {};

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

  // Defer initial sync until login-time server sync has landed so the dedup
  // lists (connections/keys/identities) reflect post-merge state. For local
  // users the promise resolves immediately; for cloud users it waits for
  // syncOnLogin to finish (vault_reset on logout wipes the config dir).
  api.lifecycle.waitForLoginSync().then(() =>
    sync(api).catch((e) => api.log.error("Initial ssh-config sync failed", e)),
  );

  api.storage.get<number>(POLL_INTERVAL_KEY).then((stored) => {
    startWatcher(stored ?? DEFAULT_POLL_INTERVAL);
  });

  const offEvent = api.events.on(RESTART_EVENT, (data) => {
    const newInterval = typeof data === "number" ? data : DEFAULT_POLL_INTERVAL;
    api.log.info(`Poll interval changed to ${newInterval}ms`);
    startWatcher(newInterval);
  });

  const offSyncNow = api.events.on(SYNC_NOW_EVENT, () => {
    api.log.info("Manual sync triggered");
    sync(api).catch((e) => api.log.error("ssh-config manual sync failed", e));
  });

  return () => {
    stopWatch?.();
    offEvent();
    offSyncNow();
  };
};
