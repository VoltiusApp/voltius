import { describe, test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const svc = () => ({
    list: vi.fn(async () => [] as unknown[]),
    create: vi.fn(async (d: Record<string, unknown>) => ({ id: "new", ...d })),
    update: vi.fn(async (id: string, d: Record<string, unknown>) => ({ id, ...d })),
    adopt: vi.fn(async (id: string, d: Record<string, unknown>) => ({ id, ...d })),
    remove: vi.fn(async () => {}),
  });
  return {
    saveTeamVaultObject: vi.fn(async (_teamId: string, _kind: string, _item: unknown) => {}),
    removeTeamVaultObject: vi.fn(async (_teamId: string, _id: string) => {}),
    reportAuditMutation: vi.fn(),
    scheduleSync: vi.fn(),
    isServerMode: vi.fn(async () => true),
    setPinned: vi.fn(async () => {}),
    connections: svc(),
    identities: svc(),
    keys: svc(),
    snippets: svc(),
    folders: svc(),
    snippetFolders: svc(),
    rules: svc(),
  };
});

vi.mock("@/services/teamObjectPersistence", () => ({
  saveTeamVaultObject: h.saveTeamVaultObject,
  removeTeamVaultObject: h.removeTeamVaultObject,
}));
vi.mock("@/services/auditMutations", () => ({ reportAuditMutation: h.reportAuditMutation }));
vi.mock("@/services/sync", () => ({ scheduleSync: h.scheduleSync }));
vi.mock("@/services/account", () => ({ isServerMode: h.isServerMode }));
vi.mock("@/stores/teamObjectPrefsStore", () => ({
  useTeamObjectPrefsStore: { getState: () => ({ setPinned: h.setPinned }) },
}));
vi.mock("@/services/connections", () => ({
  listConnections: h.connections.list, saveConnection: h.connections.create,
  updateConnection: h.connections.update, adoptConnection: h.connections.adopt,
  deleteConnection: h.connections.remove,
  setConnectionDistro: vi.fn(async () => {}), setConnectionLastUsed: vi.fn(async () => {}),
}));
vi.mock("@/services/identities", () => ({
  listIdentities: h.identities.list, saveIdentity: h.identities.create,
  updateIdentity: h.identities.update, adoptIdentity: h.identities.adopt,
  deleteIdentity: h.identities.remove,
}));
vi.mock("@/services/keys", () => ({
  listKeys: h.keys.list, saveKey: h.keys.create, updateKey: h.keys.update,
  adoptKey: h.keys.adopt, deleteKey: h.keys.remove, generateSshKeypair: vi.fn(),
}));
vi.mock("@/services/snippets", () => ({
  listSnippets: h.snippets.list, createSnippet: h.snippets.create,
  updateSnippet: h.snippets.update, adoptSnippet: h.snippets.adopt,
  deleteSnippet: h.snippets.remove,
  listSnippetFolders: h.snippetFolders.list, createSnippetFolder: h.snippetFolders.create,
  updateSnippetFolder: h.snippetFolders.update, adoptSnippetFolder: h.snippetFolders.adopt,
  deleteSnippetFolder: h.snippetFolders.remove,
}));
vi.mock("@/services/folders", () => ({
  listFolders: h.folders.list, saveFolder: h.folders.create, updateFolder: h.folders.update,
  adoptFolder: h.folders.adopt, deleteFolder: h.folders.remove,
  moveObjectsToFolder: vi.fn(async () => {}),
}));
vi.mock("@/services/portForwardingRules", () => ({
  listPfRules: h.rules.list, createPfRule: h.rules.create, updatePfRule: h.rules.update,
  adoptPfRule: h.rules.adopt, deletePfRule: h.rules.remove,
  duplicatePfRule: vi.fn(), movePfRuleFolder: vi.fn(async () => {}),
}));

import { useConnectionStore } from "./connectionStore";
import { useIdentityStore } from "./identityStore";
import { useKeyStore } from "./keyStore";
import { useSnippetStore } from "./snippetStore";
import { useFolderStore } from "./folderStore";
import { useSnippetFolderStore } from "./snippetFolderStore";
import { usePortForwardingStore } from "./portForwardingStore";
import { useTeamStore } from "./teamStore";
import { useSyncPrefsStore } from "./syncPrefsStore";
import { useHistoryStore } from "./historyStore";

type Bag = Record<string, unknown>;
type Store = { getState: () => Bag; setState: (s: Bag) => void };

interface Adapter {
  name: string;
  store: Store;
  localKey: string;
  teamKey: string;
  /** `saveTeamVaultObject`'s kind argument. */
  persistKind: string;
  /** `reportAuditMutation`'s objectType, or null when the store reports none. */
  auditKind: string | null;
  /** Set on the stored object by `pin*ForTeam`. */
  pinField: "pinned" | "favorite";
  /** Every key a local pin must send: these updates replace, they do not merge. */
  pinPayloadKeys: string[];
  api: { list: ReturnType<typeof vi.fn>; adopt: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  seed: (over?: Bag) => Bag;
  form: (over?: Bag) => Bag;
  create: (data: Bag) => Promise<unknown>;
  update: (id: string, data: Bag) => Promise<unknown>;
  remove: (id: string) => Promise<void>;
  pin: (id: string, pinned: boolean | null) => Promise<void>;
  pinForTeam: (id: string, pinned: boolean) => Promise<void>;
}

const stamps = { created_at: "t0", updated_at: "t0", clocks: {} };

const adapters: Adapter[] = [
  {
    name: "connection",
    store: useConnectionStore as unknown as Store,
    localKey: "connections", teamKey: "teamConnections",
    persistKind: "connection", auditKind: "connection", pinField: "pinned",
    pinPayloadKeys: ["name", "host", "port", "username", "auth_type", "tags", "identity_id", "key_id", "folder_id", "vault_id", "jump_hosts", "env_vars", "agent_forwarding", "legacy_algorithms", "pre_command", "post_command", "pre_snippet_id", "post_snippet_id", "ask_vars_each_time", "terminal_encoding", "distro", "icon", "pinned", "ping_disabled", "shell_integration", "keepalive_preset", "connection_type", "serial_port", "serial_baud", "serial_data_bits", "serial_parity", "serial_stop_bits", "serial_flow_control", "serial_auto_reconnect", "ftp_secure", "notes"],
    api: h.connections,
    seed: (o) => ({ id: "x1", name: "Web", host: "h", port: 22, username: "u", auth_type: "key", tags: [], vault_id: "personal", ...stamps, ...o }),
    form: (o) => ({ name: "Web", host: "h", port: 22, username: "u", auth_type: "key", tags: [], vault_id: "personal", ...o }),
    create: (d) => useConnectionStore.getState().saveConnection(d as never),
    update: (id, d) => useConnectionStore.getState().updateConnection(id, d as never),
    remove: (id) => useConnectionStore.getState().deleteConnection(id),
    pin: (id, p) => useConnectionStore.getState().pinConnection(id, p),
    pinForTeam: (id, p) => useConnectionStore.getState().pinConnectionForTeam(id, p),
  },
  {
    name: "identity",
    store: useIdentityStore as unknown as Store,
    localKey: "identities", teamKey: "teamIdentities",
    persistKind: "identity", auditKind: "identity", pinField: "pinned",
    pinPayloadKeys: ["name", "username", "key_id", "tags", "folder_id", "vault_id", "pinned"],
    api: h.identities,
    seed: (o) => ({ id: "x1", name: "root", username: "root", tags: [], vault_id: "personal", ...stamps, ...o }),
    form: (o) => ({ name: "root", username: "root", tags: [], vault_id: "personal", ...o }),
    create: (d) => useIdentityStore.getState().saveIdentity(d as never),
    update: (id, d) => useIdentityStore.getState().updateIdentity(id, d as never),
    remove: (id) => useIdentityStore.getState().deleteIdentity(id),
    pin: (id, p) => useIdentityStore.getState().pinIdentity(id, p),
    pinForTeam: (id, p) => useIdentityStore.getState().pinIdentityForTeam(id, p),
  },
  {
    name: "key",
    store: useKeyStore as unknown as Store,
    localKey: "keys", teamKey: "teamKeys",
    persistKind: "key", auditKind: "key", pinField: "pinned",
    pinPayloadKeys: ["name", "key_type", "tags", "folder_id", "vault_id", "pinned"],
    api: h.keys,
    seed: (o) => ({ id: "x1", name: "Deploy", key_type: "ed25519", tags: [], vault_id: "personal", ...stamps, ...o }),
    form: (o) => ({ name: "Deploy", key_type: "ed25519", tags: [], vault_id: "personal", ...o }),
    create: (d) => useKeyStore.getState().saveKey(d as never),
    update: (id, d) => useKeyStore.getState().updateKey(id, d as never),
    remove: (id) => useKeyStore.getState().deleteKey(id),
    pin: (id, p) => useKeyStore.getState().pinKey(id, p),
    pinForTeam: (id, p) => useKeyStore.getState().pinKeyForTeam(id, p),
  },
  {
    name: "snippet",
    store: useSnippetStore as unknown as Store,
    localKey: "snippets", teamKey: "teamSnippets",
    persistKind: "snippet", auditKind: "snippet", pinField: "favorite",
    pinPayloadKeys: ["name", "steps", "description", "tags", "folder_id", "favorite", "only_for_connection_tags", "only_for_distros", "vault_id"],
    api: h.snippets,
    seed: (o) => ({ id: "x1", name: "ls", steps: [], tags: [], vault_id: "personal", ...stamps, ...o }),
    form: (o) => ({ name: "ls", steps: [], tags: [], vault_id: "personal", ...o }),
    create: (d) => useSnippetStore.getState().createSnippet(d as never),
    update: (id, d) => useSnippetStore.getState().updateSnippet(id, d as never),
    remove: (id) => useSnippetStore.getState().deleteSnippet(id),
    pin: (id, p) => useSnippetStore.getState().pinSnippet(id, p),
    pinForTeam: (id, p) => useSnippetStore.getState().pinSnippetForTeam(id, p),
  },
  {
    name: "folder",
    store: useFolderStore as unknown as Store,
    localKey: "folders", teamKey: "teamFolders",
    persistKind: "folder", auditKind: "folder", pinField: "pinned",
    pinPayloadKeys: ["name", "object_type", "parent_folder_id", "vault_id", "pinned"],
    api: h.folders,
    seed: (o) => ({ id: "x1", name: "Prod", object_type: "connection", vault_id: "personal", ...stamps, ...o }),
    form: (o) => ({ name: "Prod", object_type: "connection", vault_id: "personal", ...o }),
    create: (d) => useFolderStore.getState().saveFolder(d as never),
    update: (id, d) => useFolderStore.getState().updateFolder(id, d as never),
    remove: (id) => useFolderStore.getState().deleteFolder(id),
    pin: (id, p) => useFolderStore.getState().pinFolder(id, p),
    pinForTeam: (id, p) => useFolderStore.getState().pinFolderForTeam(id, p),
  },
  {
    name: "snippetFolder",
    store: useSnippetFolderStore as unknown as Store,
    localKey: "folders", teamKey: "teamSnippetFolders",
    persistKind: "snippet_folder", auditKind: null, pinField: "pinned",
    pinPayloadKeys: ["name", "object_type", "parent_folder_id", "pinned"],
    api: h.snippetFolders,
    seed: (o) => ({ id: "x1", name: "Ops", object_type: "snippet", vault_id: "personal", ...stamps, ...o }),
    form: (o) => ({ name: "Ops", object_type: "snippet", vault_id: "personal", ...o }),
    create: (d) => useSnippetFolderStore.getState().saveFolder(d as never),
    update: (id, d) => useSnippetFolderStore.getState().updateFolder(id, d as never),
    remove: (id) => useSnippetFolderStore.getState().deleteFolder(id),
    pin: (id, p) => useSnippetFolderStore.getState().pinSnippetFolder(id, p),
    pinForTeam: (id, p) => useSnippetFolderStore.getState().pinSnippetFolderForTeam(id, p),
  },
];

const teamMap = (a: Adapter) => a.store.getState()[a.teamKey] as Record<string, Bag[]>;
const localList = (a: Adapter) => a.store.getState()[a.localKey] as Bag[];

function seedLocal(a: Adapter, items: Bag[]) {
  a.store.setState({ [a.localKey]: items, [a.teamKey]: {} });
}
function seedTeam(a: Adapter, map: Record<string, Bag[]>) {
  a.store.setState({ [a.localKey]: [], [a.teamKey]: map });
}

beforeEach(() => {
  vi.clearAllMocks();
  useTeamStore.setState({ teams: [{ id: "team-a" }, { id: "team-b" }] as never });
  useHistoryStore.setState({ past: [], future: [] } as never);
  for (const a of adapters) seedLocal(a, []);
  usePortForwardingStore.setState({ rules: [], teamRules: {} });
});

describe.each(adapters)("$name store", (a) => {
  test("a create into a team vault persists the object and lands it in the team map", async () => {
    seedTeam(a, {});
    await a.create(a.form({ vault_id: "team-a" }));
    expect(h.saveTeamVaultObject).toHaveBeenCalledWith("team-a", a.persistKind, expect.objectContaining({ vault_id: "team-a" }));
    expect(teamMap(a)["team-a"]).toHaveLength(1);
    expect(localList(a)).toHaveLength(0);
  });

  test("a create into a personal vault goes through the api and reloads the local list", async () => {
    a.api.list.mockResolvedValueOnce([a.seed()]);
    await a.create(a.form());
    expect(h.saveTeamVaultObject).not.toHaveBeenCalled();
    expect(localList(a)).toHaveLength(1);
  });

  test("an update moving team-a → team-b removes it from the source and upserts into the destination", async () => {
    seedTeam(a, { "team-a": [a.seed({ vault_id: "team-a" })], "team-b": [] });
    await a.update("x1", a.form({ vault_id: "team-b" }));
    expect(teamMap(a)["team-a"]).toHaveLength(0);
    expect(teamMap(a)["team-b"]).toHaveLength(1);
    expect(h.removeTeamVaultObject).toHaveBeenCalledWith("team-a", "x1");
    expect(h.saveTeamVaultObject).toHaveBeenCalledWith("team-b", a.persistKind, expect.objectContaining({ id: "x1" }));
  });

  test("an update moving team-a → personal adopts locally, empties the source and reloads the local list", async () => {
    seedTeam(a, { "team-a": [a.seed({ vault_id: "team-a" })] });
    a.api.list.mockResolvedValueOnce([a.seed()]);
    await a.update("x1", a.form({ vault_id: "personal" }));
    expect(a.api.adopt).toHaveBeenCalled();
    expect(teamMap(a)["team-a"]).toHaveLength(0);
    expect(localList(a)).toHaveLength(1);
    expect(h.removeTeamVaultObject).toHaveBeenCalledWith("team-a", "x1");
  });

  test("an update staying inside team-a upserts in place rather than duplicating", async () => {
    seedTeam(a, { "team-a": [a.seed({ vault_id: "team-a" })] });
    await a.update("x1", a.form({ vault_id: "team-a", name: "renamed" }));
    expect(teamMap(a)["team-a"]).toHaveLength(1);
    expect(teamMap(a)["team-a"][0]).toMatchObject({ id: "x1", name: "renamed" });
    expect(h.removeTeamVaultObject).not.toHaveBeenCalled();
  });

  test("an update moving personal → team-a persists to the team and upserts into the team map", async () => {
    seedLocal(a, [a.seed()]);
    a.api.list.mockResolvedValueOnce([]);
    await a.update("x1", a.form({ vault_id: "team-a" }));
    expect(h.saveTeamVaultObject).toHaveBeenCalledWith("team-a", a.persistKind, expect.objectContaining({ id: "x1" }));
    expect(teamMap(a)["team-a"]).toHaveLength(1);
  });

  test("a delete of a team object removes it from the vault and the team map", async () => {
    seedTeam(a, { "team-a": [a.seed({ vault_id: "team-a" }), a.seed({ id: "x2", vault_id: "team-a" })] });
    await a.remove("x1");
    expect(h.removeTeamVaultObject).toHaveBeenCalledWith("team-a", "x1");
    expect(teamMap(a)["team-a"].map((x) => x.id)).toEqual(["x2"]);
  });

  test("pin on a team object delegates to the team object prefs and never touches the api", async () => {
    seedTeam(a, { "team-a": [a.seed({ vault_id: "team-a" })] });
    await a.pin("x1", true);
    expect(h.setPinned).toHaveBeenCalledWith("team-a", "x1", true);
    expect(a.api.update).not.toHaveBeenCalled();
  });

  test("pinForTeam stamps the object, saves it and upserts it in place", async () => {
    seedTeam(a, { "team-a": [a.seed({ vault_id: "team-a", updated_at: "t0" })] });
    await a.pinForTeam("x1", true);
    expect(h.saveTeamVaultObject).toHaveBeenCalledWith("team-a", a.persistKind, expect.objectContaining({ id: "x1", [a.pinField]: true }));
    expect(teamMap(a)["team-a"]).toHaveLength(1);
    const saved = teamMap(a)["team-a"][0] as { updated_at: string; clocks: Record<string, string> };
    expect(saved.updated_at).not.toBe("t0");
    expect(saved.clocks.updated_at).toBe(saved.updated_at);
  });

  test("a local pin sends a full form payload, not a bare pinned flag", async () => {
    seedLocal(a, [a.seed()]);
    await a.pin("x1", true);
    const payload = a.api.update.mock.calls[0][1] as Bag;
    expect(Object.keys(payload).sort()).toEqual([...a.pinPayloadKeys].sort());
  });

  test("pinForTeam on an unknown id is a no-op", async () => {
    seedTeam(a, { "team-a": [a.seed({ vault_id: "team-a" })] });
    await a.pinForTeam("nope", true);
    expect(h.saveTeamVaultObject).not.toHaveBeenCalled();
  });

  test("setTeam replaces one vault's list and clearTeam without an argument drops every vault", () => {
    const s = a.store.getState();
    const setter = Object.entries(s).find(([k]) => /^setTeam/.test(k))![1] as (t: string, i: Bag[]) => void;
    const clearer = Object.entries(s).find(([k]) => /^clearTeam/.test(k))![1] as (t?: string) => void;
    setter("team-a", [a.seed()]);
    setter("team-b", [a.seed({ id: "x2" })]);
    expect(Object.keys(teamMap(a)).sort()).toEqual(["team-a", "team-b"]);
    clearer("team-a");
    expect(Object.keys(teamMap(a))).toEqual(["team-b"]);
    clearer();
    expect(teamMap(a)).toEqual({});
  });
});

describe("audit reporting", () => {
  test("the five audited stores report a create; the snippet folder store reports none", async () => {
    for (const a of adapters) {
      vi.clearAllMocks();
      seedTeam(a, {});
      await a.create(a.form({ vault_id: "team-a" }));
      const kinds = h.reportAuditMutation.mock.calls.map((c) => `${c[0]}:${c[1]}`);
      expect(kinds).toEqual(a.auditKind ? [`${a.auditKind}:created`] : []);
    }
  });
});

describe("sync scheduling", () => {
  const byName = (n: string) => adapters.find((a) => a.name === n)!;

  beforeEach(() => {
    useSyncPrefsStore.setState({ syncTypes: {}, excludedIds: [] });
  });

  test.each(["connection", "identity", "key", "folder"])(
    "%s honours the per-object sync preference on delete",
    async (name) => {
      const a = byName(name);
      seedLocal(a, [a.seed()]);
      useSyncPrefsStore.setState({ excludedIds: ["x1"] });
      await a.remove("x1");
      await Promise.resolve();
      await Promise.resolve();
      expect(h.scheduleSync).not.toHaveBeenCalled();
    },
  );

  test.each(["snippet", "snippetFolder"])(
    "%s schedules a sync regardless of the per-object preference",
    async (name) => {
      const a = byName(name);
      seedLocal(a, [a.seed()]);
      useSyncPrefsStore.setState({ excludedIds: ["x1"] });
      await a.remove("x1");
      await Promise.resolve();
      await Promise.resolve();
      expect(h.scheduleSync).toHaveBeenCalled();
    },
  );
});

describe("port forwarding store", () => {
  const rule = (over: Bag = {}) => ({
    id: "r1", name: "Tunnel", local_port: 1, remote_port: 2, remote_host: "h",
    tunnel_type: "local", connection_ids: [], vault_id: "personal",
    created_at: "t0", updated_at: "t0", clocks: {}, ...over,
  });

  test("a create into a team vault stamps a full per-field clock set", async () => {
    usePortForwardingStore.setState({ rules: [], teamRules: {} });
    await usePortForwardingStore.getState().createRule(rule({ vault_id: "team-a" }) as never);
    const saved = h.saveTeamVaultObject.mock.calls[0][2] as { clocks: Record<string, string> };
    expect(Object.keys(saved.clocks).sort()).toEqual([
      "bind_host", "connection_ids", "description", "folder_id", "local_port",
      "name", "remote_host", "remote_port", "target_host", "tunnel_type", "vault_id",
    ]);
  });

  test("a team → personal move adopts the rule instead of recreating it", async () => {
    usePortForwardingStore.setState({ rules: [], teamRules: { "team-a": [rule({ vault_id: "team-a" }) as never] } });
    h.rules.list.mockResolvedValueOnce([]);
    await usePortForwardingStore.getState().updateRule("r1", rule({ vault_id: "personal" }) as never);
    expect(h.rules.adopt).toHaveBeenCalledWith("r1", expect.objectContaining({ vault_id: "personal" }));
    expect(usePortForwardingStore.getState().teamRules["team-a"]).toHaveLength(0);
  });

  test("a personal → team move deletes then recreates the rule under its existing id", async () => {
    usePortForwardingStore.setState({ rules: [rule() as never], teamRules: {} });
    await usePortForwardingStore.getState().updateRule("r1", rule({ vault_id: "team-a" }) as never);
    expect(h.rules.remove).toHaveBeenCalledWith("r1");
    expect(usePortForwardingStore.getState().teamRules["team-a"][0].id).toBe("r1");
    expect(usePortForwardingStore.getState().rules).toHaveLength(0);
  });

  test("a delete of a team rule filters the team map and reports an audit row", async () => {
    usePortForwardingStore.setState({ rules: [], teamRules: { "team-a": [rule({ vault_id: "team-a" }) as never] } });
    await usePortForwardingStore.getState().deleteRule("r1");
    expect(h.removeTeamVaultObject).toHaveBeenCalledWith("team-a", "r1");
    expect(usePortForwardingStore.getState().teamRules["team-a"]).toHaveLength(0);
    expect(h.reportAuditMutation).toHaveBeenCalledWith("port_forward", "deleted", expect.objectContaining({ id: "r1" }), { tunnel_type: "local" });
  });
});
