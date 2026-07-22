import { describe, test, expect, vi, beforeEach } from "vitest";
import { sync } from "./index";
import type { PluginAPI, PluginConnection, PluginConnectionInput } from "@/plugins/api";

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
