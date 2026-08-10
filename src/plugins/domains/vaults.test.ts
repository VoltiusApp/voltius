import { describe, test, expect, beforeEach, vi } from "vitest";
import { createVaultsAPI } from "./vaults";

const deleted: string[] = [];

const state = {
  vaults: [
    { id: "personal", name: "Personal" },
    { id: "v-empty", name: "Empty" },
    { id: "v-full", name: "Full" },
    { id: "v-team", name: "Shared", teamId: "t-1" },
  ],
  connections: [{ id: "c-1", vault_id: "v-full" }],
  keys: [{ id: "k-1", vault_id: "v-full" }],
  identities: [] as { id: string; vault_id?: string }[],
  snippets: [] as { id: string; vault_id?: string }[],
  rules: [] as { id: string; vault_id?: string }[],
  folders: [{ id: "f-1", vault_id: "v-full", object_type: "connection" }],
  snippetFolders: [] as { id: string; vault_id?: string }[],
};

const ports = {
  vaults: {
    list: () => state.vaults,
    add: vi.fn((name: string) => {
      const v = { id: "v-new", name };
      state.vaults.push(v);
      return v;
    }),
    rename: vi.fn(),
    remove: vi.fn((id: string) => {
      state.vaults = state.vaults.filter((v) => v.id !== id);
    }),
  },
  isTeamVault: (id: string) => state.vaults.find((v) => v.id === id)?.teamId != null,
  contents: () => ({
    connections: state.connections,
    keys: state.keys,
    identities: state.identities,
    snippets: state.snippets,
    portForwardingRules: state.rules,
    folders: state.folders,
    snippetFolders: state.snippetFolders,
  }),
  remove: {
    connection: vi.fn(async (id: string) => { deleted.push(`connection:${id}`); }),
    key: vi.fn(async (id: string) => { deleted.push(`key:${id}`); }),
    identity: vi.fn(async (id: string) => { deleted.push(`identity:${id}`); }),
    snippet: vi.fn(async (id: string) => { deleted.push(`snippet:${id}`); }),
    portForwardingRule: vi.fn(async (id: string) => { deleted.push(`rule:${id}`); }),
    folder: vi.fn(async (id: string) => { deleted.push(`folder:${id}`); }),
    snippetFolder: vi.fn(async (id: string) => { deleted.push(`snippetFolder:${id}`); }),
  },
};

const api = () => createVaultsAPI(ports);

beforeEach(() => {
  deleted.length = 0;
  state.vaults = [
    { id: "personal", name: "Personal" },
    { id: "v-empty", name: "Empty" },
    { id: "v-full", name: "Full" },
    { id: "v-team", name: "Shared", teamId: "t-1" },
  ];
  vi.clearAllMocks();
});

describe("list", () => {
  test("returns every vault and marks the team-backed one", () => {
    const list = api().list();
    expect(list.map((v) => v.id)).toEqual(["personal", "v-empty", "v-full", "v-team"]);
    expect(list.find((v) => v.id === "v-team")!.team).toBe(true);
    expect(list.find((v) => v.id === "personal")!.team).toBe(false);
  });
});

describe("rename", () => {
  test("renames a local vault", () => {
    api().rename("v-empty", "Renamed");
    expect(ports.vaults.rename).toHaveBeenCalledWith("v-empty", "Renamed");
  });

  test("refuses a team vault and never calls the store", () => {
    expect(() => api().rename("v-team", "Nope")).toThrow(/team vault/i);
    expect(ports.vaults.rename).not.toHaveBeenCalled();
  });

  test("refuses an unknown vault", () => {
    expect(() => api().rename("nope", "x")).toThrow(/not found/i);
  });
});

describe("delete", () => {
  test("deletes an empty vault", async () => {
    await api().delete("v-empty");
    expect(ports.vaults.remove).toHaveBeenCalledWith("v-empty");
  });

  test("refuses the personal vault and never calls the store", async () => {
    await expect(api().delete("personal")).rejects.toThrow(/personal/i);
    expect(ports.vaults.remove).not.toHaveBeenCalled();
  });

  test("refuses a team vault", async () => {
    await expect(api().delete("v-team")).rejects.toThrow(/team vault/i);
    expect(ports.vaults.remove).not.toHaveBeenCalled();
  });

  test("refuses a non-empty vault, naming the counts, and deletes nothing", async () => {
    await expect(api().delete("v-full")).rejects.toThrow(/1 connection.*1 key.*1 folder/is);
    expect(ports.vaults.remove).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  test("cascade deletes the contents before the vault itself", async () => {
    await api().delete("v-full", { cascade: true });
    expect(deleted).toEqual(["connection:c-1", "key:k-1", "folder:f-1"]);
    expect(ports.vaults.remove).toHaveBeenCalledWith("v-full");
  });

  test("cascade on an empty vault deletes nothing extra", async () => {
    await api().delete("v-empty", { cascade: true });
    expect(deleted).toEqual([]);
    expect(ports.vaults.remove).toHaveBeenCalledWith("v-empty");
  });

  test("an object with no vault_id belongs to personal, not to every vault", async () => {
    state.snippets = [{ id: "s-1" }];
    await api().delete("v-empty");
    expect(ports.vaults.remove).toHaveBeenCalledWith("v-empty");
    state.snippets = [];
  });
});

describe("create", () => {
  test("creates and returns the new vault", () => {
    const v = api().create("Fresh");
    expect(ports.vaults.add).toHaveBeenCalledWith("Fresh");
    expect(v).toEqual({ id: "v-new", name: "Fresh", team: false });
  });

  test("refuses a blank name", () => {
    expect(() => api().create("   ")).toThrow(/name/i);
    expect(ports.vaults.add).not.toHaveBeenCalled();
  });
});
