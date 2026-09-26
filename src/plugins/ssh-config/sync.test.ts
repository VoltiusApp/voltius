import { describe, test, expect, vi, beforeEach } from "vitest";
import { sync } from "./index";
import type { PluginAPI, PluginConnection, PluginConnectionInput } from "@/plugins/api";
import { createI18nAPI } from "@/plugins/domains/i18n";
import { messages } from "./i18n";

const TAG = "ssh-config";

interface HarnessOpts {
  config: string;
  connections?: PluginConnection[];
  storage?: Record<string, unknown>;
}

// Stateful mock: a mutable connection list backed by create/update/delete, a
// Map-backed storage, and a swappable ~/.ssh/config for multi-sync tests.
function makeSyncApi(opts: HarnessOpts) {
  const connections: PluginConnection[] = (opts.connections ?? []).map((c) => ({ ...c }));
  const store = new Map<string, unknown>(Object.entries(opts.storage ?? {}));
  let config = opts.config;
  let idSeq = 1000;

  const create = vi.fn(async (data: PluginConnectionInput) => {
    const conn: PluginConnection = {
      id: `gen-${idSeq++}`,
      name: data.name,
      host: data.host,
      port: data.port,
      username: data.username,
      auth_type: data.auth_type,
      tags: data.tags ?? [],
      identity_id: data.identity_id,
      jump_hosts: data.jump_hosts,
    };
    connections.push(conn);
    return { ...conn };
  });
  const update = vi.fn(async (id: string, data: Partial<PluginConnectionInput>) => {
    const c = connections.find((x) => x.id === id);
    if (c) Object.assign(c, data);
  });
  const del = vi.fn(async (id: string) => {
    const i = connections.findIndex((x) => x.id === id);
    if (i >= 0) connections.splice(i, 1);
  });

  const api = {
    isActive: () => true,
    fs: {
      exists: vi.fn(async (p: string) => p === "~/.ssh/config"),
      readText: vi.fn(async () => config),
      writeText: vi.fn(async () => {}),
      watch: vi.fn(() => () => {}),
    },
    connections: {
      list: vi.fn(async () => connections.map((c) => ({ ...c }))),
      create,
      update,
      delete: del,
    },
    keys: { list: vi.fn(async () => []), create: vi.fn(), delete: vi.fn() },
    identities: { list: vi.fn(async () => []), create: vi.fn(), delete: vi.fn() },
    storage: {
      get: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
      set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
      delete: vi.fn(async (k: string) => { store.delete(k); }),
    },
    notifications: { toast: vi.fn() },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    i18n: createI18nAPI(messages),
  } as unknown as PluginAPI;

  return {
    api,
    connections,
    store,
    create,
    update,
    del,
    setConfig: (c: string) => { config = c; },
  };
}

const cfg = (alias: string, host: string, user: string, port = 22, extra = "") =>
  `Host ${alias}\n  HostName ${host}\n  User ${user}\n  Port ${port}\n${extra}`;

const conn = (over: Partial<PluginConnection> & { id: string }): PluginConnection => ({
  name: undefined,
  host: "h",
  port: 22,
  username: "u",
  auth_type: "password",
  tags: [],
  ...over,
});

describe("ssh-config sync — baseline behavior (characterization)", () => {
  beforeEach(() => vi.clearAllMocks());

  test("no ~/.ssh/config → early return, no connection reads", async () => {
    const h = makeSyncApi({ config: "" });
    (h.api.fs.exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await sync(h.api);
    expect(h.api.connections.list).not.toHaveBeenCalled();
  });

  test("a tagged connection matching a config host is not duplicated", async () => {
    const h = makeSyncApi({
      config: cfg("Oracle", "1.2.3.4", "ubuntu"),
      connections: [
        conn({ id: "t-1", name: "Oracle", host: "1.2.3.4", port: 22, username: "ubuntu", tags: [TAG] }),
      ],
    });
    await sync(h.api);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.connections).toHaveLength(1);
  });
});

describe("ssh-config sync — adoption", () => {
  beforeEach(() => vi.clearAllMocks());

  test("adopts an untagged match instead of creating a duplicate", async () => {
    const h = makeSyncApi({
      config: cfg("Oracle", "1.2.3.4", "ubuntu"),
      connections: [
        conn({ id: "user-1", name: "Serv Oracle", host: "1.2.3.4", port: 22, username: "ubuntu", tags: [] }),
      ],
    });
    await sync(h.api);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.connections).toHaveLength(1);
    expect(h.store.get("alias_map")).toEqual({ Oracle: "user-1" });
  });

  // Since #77 the plugin API lists team-vault connections too. Adopting one
  // would claim a connection shared with the whole team, and the update that
  // follows any config edit is refused by the runtime.
  test("never adopts a team connection, creating its own instead", async () => {
    const h = makeSyncApi({
      config: cfg("Oracle", "1.2.3.4", "ubuntu"),
      connections: [
        { ...conn({ id: "team-1", name: "Shared", host: "1.2.3.4", port: 22, username: "ubuntu", tags: [] }), team: true },
      ],
    });
    await sync(h.api);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.del).not.toHaveBeenCalled();
    expect(h.store.get("alias_map")).toEqual({ Oracle: "gen-1000" });
  });

  test("preserves the user's label, auth, identity and tags; creates no key/identity", async () => {
    const h = makeSyncApi({
      config: cfg("Oracle", "1.2.3.4", "ubuntu"),
      connections: [
        conn({
          id: "user-1", name: "Serv Oracle", host: "1.2.3.4", port: 22, username: "ubuntu",
          auth_type: "key", identity_id: "id-9", tags: [],
        }),
      ],
    });
    await sync(h.api);
    const c = h.connections[0];
    expect(c.name).toBe("Serv Oracle");
    expect(c.auth_type).toBe("key");
    expect(c.identity_id).toBe("id-9");
    expect(c.tags).toEqual([]);
    expect(h.api.keys.create).not.toHaveBeenCalled();
    expect(h.api.identities.create).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled(); // host/port/user already match → no-op
    expect(h.create).not.toHaveBeenCalled();
    expect(h.connections).toHaveLength(1);
  });

  test("first untagged match wins; the rest are left untouched", async () => {
    const h = makeSyncApi({
      config: cfg("Oracle", "1.2.3.4", "ubuntu"),
      connections: [
        conn({ id: "user-1", name: "First", host: "1.2.3.4", port: 22, username: "ubuntu", tags: [] }),
        conn({ id: "user-2", name: "Second", host: "1.2.3.4", port: 22, username: "ubuntu", tags: [] }),
      ],
    });
    await sync(h.api);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.connections).toHaveLength(2);
    expect(h.store.get("alias_map")).toEqual({ Oracle: "user-1" });
  });

  test("setting OFF ignores the untagged connection and creates a tagged duplicate", async () => {
    const h = makeSyncApi({
      config: cfg("Oracle", "1.2.3.4", "ubuntu"),
      connections: [
        conn({ id: "user-1", name: "Serv Oracle", host: "1.2.3.4", port: 22, username: "ubuntu", tags: [] }),
      ],
      storage: { adopt_untagged_enabled: false },
    });
    await sync(h.api);
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.connections).toHaveLength(2);
    const created = h.connections.find((c) => c.id.startsWith("gen-"))!;
    expect(created.tags).toContain(TAG);
  });

  test("an adopted match with an IdentityFile still skips key/identity creation", async () => {
    const h = makeSyncApi({
      config: cfg("Oracle", "1.2.3.4", "ubuntu", 22, "  IdentityFile ~/.ssh/id_ed25519\n"),
      connections: [
        conn({ id: "user-1", name: "Serv Oracle", host: "1.2.3.4", port: 22, username: "ubuntu", auth_type: "password", tags: [] }),
      ],
    });
    await sync(h.api);
    expect(h.api.keys.create).not.toHaveBeenCalled();
    expect(h.api.identities.create).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    const c = h.connections.find((x) => x.id === "user-1")!;
    expect(c.tags).toEqual([]);
    expect(c.auth_type).toBe("password");
    expect(c.identity_id).toBeUndefined();
  });
});

describe("ssh-config sync — ProxyJump + adoption", () => {
  beforeEach(() => vi.clearAllMocks());

  test("does not write jump_hosts onto an adopted connection", async () => {
    const h = makeSyncApi({
      config:
        cfg("bastion", "bastion.com", "root") +
        cfg("app", "app.com", "ubuntu", 22, "  ProxyJump bastion\n"),
      connections: [
        conn({ id: "user-b", name: "Bastion", host: "bastion.com", port: 22, username: "root", tags: [] }),
        conn({ id: "user-a", name: "App", host: "app.com", port: 22, username: "ubuntu", tags: [] }),
      ],
    });
    await sync(h.api);
    // Both hosts adopted; the plugin must not write jump_hosts onto the adopted connection,
    // even though ProxyJump resolves to another adopted host.
    const app = h.connections.find((c) => c.id === "user-a")!;
    expect(app.jump_hosts).toBeUndefined();
    const jumpWrites = h.update.mock.calls.filter(([, data]) => "jump_hosts" in (data as object));
    expect(jumpWrites).toHaveLength(0);
  });

  test("writes jump_hosts onto a plugin-created (tagged) connection", async () => {
    const h = makeSyncApi({
      config:
        cfg("bastion", "bastion.com", "root") +
        cfg("app", "app.com", "ubuntu", 22, "  ProxyJump bastion\n"),
      connections: [],
    });
    await sync(h.api);

    const bastion = h.connections.find((c) => c.name === "bastion")!;
    const app = h.connections.find((c) => c.name === "app")!;
    expect(bastion.tags).toContain(TAG);
    expect(app.tags).toContain(TAG);

    const jumpWrites = h.update.mock.calls.filter(
      ([id, data]) => id === app.id && "jump_hosts" in (data as object),
    );
    expect(jumpWrites).toHaveLength(1);
    expect(app.jump_hosts?.[0]?.connection_id).toBe(bastion.id);
  });
});

describe("ssh-config sync — adopted connections are never deleted", () => {
  beforeEach(() => vi.clearAllMocks());

  test("removing the alias from config keeps the adopted connection, clears alias_map", async () => {
    const h = makeSyncApi({
      config: cfg("Oracle", "1.2.3.4", "ubuntu"),
      connections: [
        conn({ id: "user-1", name: "Serv Oracle", host: "1.2.3.4", port: 22, username: "ubuntu", tags: [] }),
      ],
    });
    await sync(h.api);
    expect(h.store.get("alias_map")).toEqual({ Oracle: "user-1" });

    vi.clearAllMocks();
    h.setConfig(""); // alias removed from config
    await sync(h.api);

    expect(h.del).not.toHaveBeenCalled();
    expect(h.connections.some((c) => c.id === "user-1")).toBe(true);
    expect(h.store.get("alias_map")).toEqual({});
  });
});

describe("ssh-config sync — adopted connection lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  test("re-finds the adopted connection on a second sync (no duplicate)", async () => {
    const h = makeSyncApi({
      config: cfg("Oracle", "1.2.3.4", "ubuntu"),
      connections: [
        conn({ id: "user-1", name: "Serv Oracle", host: "1.2.3.4", port: 22, username: "ubuntu", tags: [] }),
      ],
    });
    await sync(h.api);
    vi.clearAllMocks();
    h.store.set("adopt_untagged_enabled", false); // isolate the alias_map id-based re-find from the content fallback
    await sync(h.api);
    expect(h.create).not.toHaveBeenCalled();
    expect(h.connections).toHaveLength(1);
  });

  test("propagates host/port config edits to the adopted connection, nothing else", async () => {
    const h = makeSyncApi({
      config: cfg("Oracle", "1.2.3.4", "ubuntu"),
      connections: [
        conn({ id: "user-1", name: "Serv Oracle", host: "1.2.3.4", port: 22, username: "ubuntu", tags: [] }),
      ],
    });
    await sync(h.api);
    vi.clearAllMocks();
    h.setConfig(cfg("Oracle", "5.6.7.8", "ubuntu", 2222));
    await sync(h.api);

    const c = h.connections.find((x) => x.id === "user-1")!;
    expect(c.host).toBe("5.6.7.8");
    expect(c.port).toBe(2222);
    expect(c.name).toBe("Serv Oracle"); // untouched
    expect(c.tags).toEqual([]);         // still untagged
    // The only write is the host/port/user update.
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update.mock.calls[0][1]).toEqual({ host: "5.6.7.8", port: 2222, username: "ubuntu" });
  });
});

describe("ssh-config sync — concurrent runs", () => {
  beforeEach(() => vi.clearAllMocks());

  test("two overlapping syncs create the host once, not twice", async () => {
    const h = makeSyncApi({ config: cfg("oracle", "1.2.3.4", "ubuntu") });
    await Promise.all([sync(h.api), sync(h.api)]);

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.connections).toHaveLength(1);
  });

  test("an overlapping sync does not strand a stale alias map", async () => {
    const h = makeSyncApi({ config: cfg("oracle", "1.2.3.4", "ubuntu") });
    await Promise.all([sync(h.api), sync(h.api)]);

    const aliasMap = h.store.get("alias_map") as Record<string, string>;
    expect(Object.values(aliasMap)).toEqual([h.connections[0].id]);
  });
});

describe("ssh-config sync — diagnostics", () => {
  beforeEach(() => vi.clearAllMocks());

  test("logs the trigger, each write and how the target connection was resolved", async () => {
    const h = makeSyncApi({
      config: cfg("oracle", "5.6.7.8", "ubuntu"),
      connections: [
        conn({ id: "t1", name: "oracle", host: "1.2.3.4", username: "ubuntu", tags: [TAG] }),
        conn({ id: "t2", name: "gone", host: "9.9.9.9", tags: [TAG] }),
      ],
      storage: { alias_map: { oracle: "t1", gone: "t2" } },
    });
    await sync(h.api, "watch");

    const lines = (h.api.log.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("trigger=watch"))).toBe(true);
    expect(lines.some((l) => l.includes('deleting conn t2 "gone"'))).toBe(true);
    expect(lines.some((l) => l.includes("update conn t1") && l.includes("via alias_map"))).toBe(true);
    expect(lines.some((l) => l.startsWith("sync #") && l.includes("alias_map after"))).toBe(true);
  });
});

describe("ssh-config sync — one connection per alias", () => {
  beforeEach(() => vi.clearAllMocks());

  const twoHosts = cfg("Oracle", "89.0.0.1", "ubuntu") + "\n" + cfg("TradingSim", "129.0.0.1", "ubuntu");

  test("a poisoned alias_map sharing one id no longer rewrites that connection as the other host", async () => {
    const h = makeSyncApi({
      config: twoHosts,
      connections: [
        conn({ id: "X", name: "Oracle", host: "89.0.0.1", username: "ubuntu", tags: [TAG] }),
        conn({ id: "T", name: "TradingSim", host: "129.0.0.1", username: "ubuntu", tags: [TAG] }),
      ],
      storage: { alias_map: { Oracle: "X", TradingSim: "X" } },
    });
    await sync(h.api);

    const x = h.connections.find((c) => c.id === "X")!;
    expect(x.name).toBe("Oracle");
    expect(x.host).toBe("89.0.0.1");
    expect(h.store.get("alias_map")).toEqual({ Oracle: "X", TradingSim: "T" });
    expect(h.create).not.toHaveBeenCalled();
  });

  test("heals a connection an earlier sync already rewrote", async () => {
    const h = makeSyncApi({
      config: twoHosts,
      connections: [conn({ id: "X", name: "TradingSim", host: "129.0.0.1", username: "ubuntu", tags: [TAG] })],
      storage: { alias_map: { Oracle: "X", TradingSim: "X" } },
    });
    await sync(h.api);

    const x = h.connections.find((c) => c.id === "X")!;
    expect(x.name).toBe("Oracle");
    expect(x.host).toBe("89.0.0.1");
    const aliasMap = h.store.get("alias_map") as Record<string, string>;
    expect(aliasMap.Oracle).toBe("X");
    expect(aliasMap.TradingSim).not.toBe("X");
    expect(h.connections.find((c) => c.id === aliasMap.TradingSim)?.host).toBe("129.0.0.1");
  });

  test("a new stanza copied from an existing one does not claim that host's connection", async () => {
    const h = makeSyncApi({
      config: twoHosts.replace("129.0.0.1", "89.0.0.1"),
      connections: [conn({ id: "X", name: "Oracle", host: "89.0.0.1", username: "ubuntu", tags: [TAG] })],
      storage: { alias_map: { Oracle: "X" } },
    });
    await sync(h.api);

    const aliasMap = h.store.get("alias_map") as Record<string, string>;
    expect(aliasMap.TradingSim).not.toBe("X");

    h.setConfig(twoHosts);
    await sync(h.api);
    expect(h.connections.find((c) => c.id === "X")).toMatchObject({ name: "Oracle", host: "89.0.0.1" });
  });

  test("a shared id is never deleted while an alias still present in the config owns it", async () => {
    const h = makeSyncApi({
      config: cfg("TradingSim", "129.0.0.1", "ubuntu"),
      connections: [conn({ id: "X", name: "TradingSim", host: "129.0.0.1", username: "ubuntu", tags: [TAG] })],
      storage: { alias_map: { Oracle: "X", TradingSim: "X" } },
    });
    await sync(h.api);

    expect(h.del).not.toHaveBeenCalled();
    expect(h.store.get("alias_map")).toEqual({ TradingSim: "X" });
  });
});

describe("ssh-config sync — identity follows the stanza's IdentityFile", () => {
  beforeEach(() => vi.clearAllMocks());

  test("a mapped identity holding another key is not reused", async () => {
    const h = makeSyncApi({
      config: cfg("TradingSim", "129.0.0.1", "ubuntu", 22, "  IdentityFile ~/.ssh/tradingsim\n"),
      connections: [
        conn({ id: "T", name: "TradingSim", host: "129.0.0.1", username: "ubuntu", auth_type: "key", identity_id: "I-good", tags: [TAG] }),
      ],
      storage: {
        alias_map: { TradingSim: "T" },
        key_map: { "~/.ssh/tradingsim": "K-ts" },
        identity_map: { TradingSim: "I-stale" },
      },
    });
    (h.api.keys.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "K-oracle", name: "oracle", tags: [TAG] },
      { id: "K-ts", name: "tradingsim", tags: [TAG] },
    ]);
    (h.api.identities.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "I-stale", name: "TradingSim", username: "ubuntu", key_id: "K-oracle", tags: [TAG] },
      { id: "I-good", name: "TradingSim", username: "ubuntu", key_id: "K-ts", tags: [TAG] },
    ]);

    await sync(h.api);

    expect(h.connections.find((c) => c.id === "T")!.identity_id).toBe("I-good");
    expect((h.store.get("identity_map") as Record<string, string>).TradingSim).toBe("I-good");
  });
});
