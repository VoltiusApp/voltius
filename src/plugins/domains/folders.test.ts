import { describe, test, expect, beforeEach, vi } from "vitest";
import { createFoldersAPI, type FolderPorts, type FolderWrite } from "./folders";

const calls: string[] = [];

let general = [
  { id: "f-conn", name: "Prod", object_type: "connection", vault_id: "personal", parent_folder_id: undefined },
  { id: "f-key", name: "Work keys", object_type: "keychain", vault_id: "v-1", parent_folder_id: "f-root" },
  { id: "f-pf", name: "Tunnels", object_type: "port_forwarding", vault_id: "personal" },
  { id: "f-team", name: "Team stuff", object_type: "connection", vault_id: "t-1" },
];
let snippet = [{ id: "f-snip", name: "Deploys", object_type: "snippet", vault_id: "personal" }];

const ports: FolderPorts = {
  general: {
    list: () => general,
    save: vi.fn(async (data: FolderWrite) => {
      calls.push(`general.save:${data.object_type}:${data.name}:${data.vault_id}`);
      return { id: "new-general", ...data };
    }),
    update: vi.fn(async (id: string, data: FolderWrite) => {
      calls.push(`general.update:${id}:${data.name}`);
    }),
    remove: vi.fn(async (id: string, cascade: boolean) => {
      calls.push(`general.remove:${id}:${cascade}`);
    }),
  },
  snippet: {
    list: () => snippet,
    save: vi.fn(async (data: FolderWrite) => {
      calls.push(`snippet.save:${data.name}:${data.vault_id}`);
      return { id: "new-snippet", ...data };
    }),
    update: vi.fn(async (id: string, data: FolderWrite) => {
      calls.push(`snippet.update:${id}:${data.name}`);
    }),
    remove: vi.fn(async (id: string) => {
      calls.push(`snippet.remove:${id}`);
    }),
  },
  isTeamVault: (id: string) => id === "t-1",
};

const api = () => createFoldersAPI(ports);

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  general = [
    { id: "f-conn", name: "Prod", object_type: "connection", vault_id: "personal", parent_folder_id: undefined },
    { id: "f-key", name: "Work keys", object_type: "keychain", vault_id: "v-1", parent_folder_id: "f-root" },
    { id: "f-pf", name: "Tunnels", object_type: "port_forwarding", vault_id: "personal" },
    { id: "f-team", name: "Team stuff", object_type: "connection", vault_id: "t-1" },
  ];
  snippet = [{ id: "f-snip", name: "Deploys", object_type: "snippet", vault_id: "personal" }];
});

describe("list", () => {
  test("spans both stores and projects the contract", () => {
    const all = api().list();
    expect(all.map((f) => f.id).sort()).toEqual(["f-conn", "f-key", "f-pf", "f-snip", "f-team"]);
    expect(all.find((f) => f.id === "f-snip")!.kind).toBe("snippet");
    expect(all.find((f) => f.id === "f-key")).toMatchObject({
      kind: "keychain", vaultId: "v-1", parentFolderId: "f-root", team: false,
    });
    expect(all.find((f) => f.id === "f-conn")!.parentFolderId).toBe(null);
  });

  test("marks a folder in a team vault", () => {
    expect(api().list().find((f) => f.id === "f-team")!.team).toBe(true);
  });

  test("filters by kind, and snippet reads the other store", () => {
    expect(api().list("connection").map((f) => f.id)).toEqual(["f-conn", "f-team"]);
    expect(api().list("snippet").map((f) => f.id)).toEqual(["f-snip"]);
  });

  test("rejects an unknown kind, naming the legal values", () => {
    expect(() => api().list("keys" as never)).toThrow(/connection.*keychain.*port_forwarding.*snippet/s);
  });
});

describe("create", () => {
  test("a snippet folder goes to the snippet store, not the general one", async () => {
    await api().create({ kind: "snippet", name: "Nightly" });
    expect(calls).toEqual(["snippet.save:Nightly:personal"]);
    expect(ports.general.save).not.toHaveBeenCalled();
  });

  test("the other three kinds go to the general store with their object_type", async () => {
    await api().create({ kind: "port_forwarding", name: "Lab", vaultId: "v-1" });
    expect(calls).toEqual(["general.save:port_forwarding:Lab:v-1"]);
  });

  test("defaults to the personal vault", async () => {
    const created = await api().create({ kind: "connection", name: "Edge" });
    expect(created.vaultId).toBe("personal");
    expect(created.kind).toBe("connection");
  });

  test("refuses a team vault and writes nothing", async () => {
    await expect(api().create({ kind: "connection", name: "X", vaultId: "t-1" })).rejects.toThrow(/team vault/i);
    expect(calls).toEqual([]);
  });

  test("refuses a blank name", async () => {
    await expect(api().create({ kind: "connection", name: "  " })).rejects.toThrow(/name/i);
  });
});

describe("rename", () => {
  test("renames in the store that owns the folder", async () => {
    await api().rename("f-snip", "Releases");
    expect(calls).toEqual(["snippet.update:f-snip:Releases"]);
  });

  test("preserves kind, vault and parent — a rename must not reparent", async () => {
    await api().rename("f-key", "Personal keys");
    const [, data] = vi.mocked(ports.general.update).mock.calls[0];
    expect(data).toMatchObject({ object_type: "keychain", vault_id: "v-1", parent_folder_id: "f-root" });
  });

  test("refuses a folder in a team vault", async () => {
    await expect(api().rename("f-team", "Nope")).rejects.toThrow(/team vault/i);
    expect(calls).toEqual([]);
  });

  test("refuses an unknown id", async () => {
    await expect(api().rename("ghost", "x")).rejects.toThrow(/not found/i);
  });
});

describe("delete", () => {
  test("cascades by default on the general store", async () => {
    await api().delete("f-conn");
    expect(calls).toEqual(["general.remove:f-conn:true"]);
  });

  test("cascade false keeps the contents", async () => {
    await api().delete("f-conn", { cascade: false });
    expect(calls).toEqual(["general.remove:f-conn:false"]);
  });

  test("the snippet store has no cascade option, so the flag is not silently accepted", async () => {
    await expect(api().delete("f-snip", { cascade: false })).rejects.toThrow(/snippet folder/i);
    expect(calls).toEqual([]);
  });

  test("a snippet folder deletes through its own store", async () => {
    await api().delete("f-snip");
    expect(calls).toEqual(["snippet.remove:f-snip"]);
  });

  test("refuses a folder in a team vault", async () => {
    await expect(api().delete("f-team")).rejects.toThrow(/team vault/i);
    expect(calls).toEqual([]);
  });
});
