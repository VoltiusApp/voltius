// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@/lib/invoke";
import * as connApi from "@/services/connections";
import { newImportCtx } from "@/services/import-export/context";
import { readOpensshFiles } from "@/services/import-export/parsers/openssh";
import { importCtxOf } from "@/services/import-export/storeAccess";
import { useTeamStore } from "@/stores/teamStore";
import { activate, changeSync, detach, keyRows, linkAgain, planRows, turnOff } from "./link";
import { sshConfigSync } from "./sync";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn(), getDeviceId: vi.fn(async () => "d1") }));
vi.mock("@/services/account", () => ({ isServerMode: async () => false }));
vi.mock("@/services/connections", () => ({ listConnections: vi.fn(async () => []) }));
vi.mock("@/services/import-export/storeAccess", () => ({ importCtxOf: vi.fn(), importIntoVault: vi.fn(), reloadKeys: vi.fn() }));
vi.mock("@/services/import-export/parsers/openssh", async (orig) => ({ ...(await orig<object>()), readOpensshFiles: vi.fn() }));
vi.mock("./sync", async (orig) => ({ ...(await orig<object>()), sshConfigSync: { request: vi.fn() } }));

const c = (id: string, name: string, host: string, username = "u", port = 22, vault_id = "personal") =>
  ({ id, name, host, port, username, vault_id, connection_type: "ssh" }) as never;
const h = (alias: string, hostname: string, user = "u", port = 22) => ({ alias, hostname, user, port });

let disk: string | null = null;
beforeEach(() => {
  disk = null;
  useTeamStore.setState({ teams: [{ id: "team-abc" } as never] });
  vi.mocked(sshConfigSync.request).mockClear();
  vi.mocked(connApi.listConnections).mockResolvedValue([c("c1", "web", "1"), c("c2", "db", "2")]);
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "ssh_config_state_load") return disk;
    if (cmd === "ssh_config_state_save") disk = (args as { state: string }).state;
  });
});

describe("planRows (activate)", () => {
  it("links by legacy id first, then detached entry, then name+address, then address", () => {
    const rows = planRows(
      [h("prod-web", "10.0.0.11"), h("old", "10.0.0.12"), h("bastion", "b.net"), h("db-internal", "10.0.0.40")],
      [],
      [c("c1", "Prod Web", "1.1.1.1"), c("c2", "Old", "9.9.9.9"), c("c3", "bastion", "b.net"), c("c4", "Base interne", "10.0.0.40")],
      { legacyAliases: { "prod-web": "c1" }, managed: { c2: { alias: "old", at: 1, gone: "detached", devices: {} } } },
      "activate",
    );
    expect(rows.map((r) => [r.alias, r.kind, "reason" in r ? r.reason : undefined])).toEqual([
      ["prod-web", "link", "legacy"], ["old", "link", "detached"], ["bastion", "link", "name"], ["db-internal", "link", "address"],
    ]);
  });

  it("offers a host to one alias only and stops at an ambiguous level", () => {
    const rows = planRows([h("a", "10.0.0.1"), h("b", "10.0.0.1"), h("homelab", "192.168.1.10", "root")], [],
      [c("c1", "x", "10.0.0.1"), c("h1", "Homelab", "192.168.1.10", "root"), c("h2", "NAS", "192.168.1.10", "root")], {}, "activate");
    expect(rows.map((r) => r.kind)).toEqual(["link", "create", "ambiguous"]);
  });

  it("never offers a team-vault host or an already managed one", () => {
    const rows = planRows([h("web", "10.0.0.1"), h("db", "10.0.0.2")], [],
      [c("t1", "web", "10.0.0.1", "u", 22, "team-abc"), c("m1", "db", "10.0.0.2")],
      { managed: { m1: { alias: "other", at: 1, devices: {} } } }, "activate");
    expect(rows.map((r) => r.kind)).toEqual(["create", "create"]);
  });

  it("shows an alias another computer already manages instead of linking a second host to it", () => {
    const state = { managed: { m1: { alias: "web", at: 1, devices: {} }, m9: { alias: "db", at: 1, devices: {} } } };
    const rows = planRows([h("web", "10.0.0.1"), h("db", "10.0.0.2")], [], [c("m1", "web", "10.0.0.1"), c("mine", "db", "10.0.0.2")], state, "activate");
    expect(rows).toMatchObject([{ kind: "managed", alias: "web" }, { kind: "skipped", alias: "db", reason: "pending" }]);
  });
});

describe("planRows (identity)", () => {
  it("names the identity a linked host loses to the file's key", () => {
    const withIdentity = (id: string, name: string, host: string) => ({ ...(c(id, name, host) as object), identity_id: "i1" }) as never;
    const rows = planRows([{ ...h("web", "10.0.0.1"), identityFile: "~/.ssh/id" }, h("db", "10.0.0.2")], [],
      [withIdentity("c1", "web", "10.0.0.1"), withIdentity("c2", "db", "10.0.0.2")], {}, "activate", [{ id: "i1", name: "Work", username: "u" }]);
    expect(rows).toMatchObject([{ kind: "link", alias: "web", identityName: "Work" }, { kind: "link", alias: "db" }]);
    expect(rows[1]).not.toHaveProperty("identityName");
  });
});

describe("planRows (global level priority)", () => {
  it("lets a legacy link beat an address match listed before it", () => {
    const rows = planRows([h("first", "10.0.0.1"), h("second", "10.0.0.9")], [], [c("c1", "x", "10.0.0.1")],
      { legacyAliases: { second: "c1" } }, "activate");
    expect(rows.map((r) => [r.alias, r.kind])).toEqual([["first", "create"], ["second", "link"]]);
  });
});

describe("planRows (review)", () => {
  it("prefers a live entry with an existing host over a detached one for the same alias", () => {
    const rows = planRows([h("web", "1")], [], [c("c1", "Web", "1"), c("c2", "Old", "1")],
      { managed: { c2: { alias: "web", at: 9, gone: "detached", devices: {} }, c1: { alias: "web", at: 1, devices: {} } } }, "review");
    expect(rows).toEqual([{ kind: "managed", alias: "web", target: "u@1:22", connectionName: "Web" }]);
  });

  it("falls back to the newest detached entry", () => {
    const rows = planRows([h("web", "1")], [], [c("c1", "A", "1"), c("c2", "B", "1")],
      { managed: { c1: { alias: "web", at: 1, gone: "detached", devices: {} }, c2: { alias: "web", at: 5, gone: "detached", devices: {} } } }, "review");
    expect(rows).toMatchObject([{ kind: "detached", connectionId: "c2" }]);
  });

  it("shows managed, detached and skipped aliases", () => {
    const rows = planRows([h("web", "1"), h("b2", "2")], [{ alias: "coder", reason: "proxyCommand", target: "coder" }],
      [c("c1", "Web", "1"), c("c2", "Build 2", "2")],
      { managed: { c1: { alias: "web", at: 1, devices: {} }, c2: { alias: "b2", at: 1, gone: "detached", devices: {} } } }, "review");
    expect(rows.map((r) => r.kind)).toEqual(["managed", "detached", "skipped"]);
  });

  it("shows an alias whose managed host has not arrived on this device as waiting", () => {
    const rows = planRows([h("web", "9")], [], [], { managed: { c9: { alias: "web", at: 1, devices: {} } } }, "review");
    expect(rows).toEqual([{ kind: "skipped", alias: "web", target: "u@9:22", reason: "pending" }]);
  });

  it("shows a detached alias whose host was deleted", () => {
    const rows = planRows([h("gone", "9")], [], [], { managed: { c9: { alias: "gone", at: 1, gone: "detached", devices: {} } } }, "review");
    expect(rows).toEqual([{ kind: "detached", alias: "gone", target: "u@9:22", connectionId: "c9", connectionName: "gone", deleted: true }]);
  });
});

describe("keyRows", () => {
  it("lists each IdentityFile key once with what will happen to it", async () => {
    vi.mocked(readOpensshFiles).mockResolvedValue({
      config: null, configError: null, includes: {},
      keys: {
        "~/.ssh/id_a": { privateKey: null, publicKey: "ssh-ed25519 AAAA a", privateReadable: true },
        "~/.ssh/id_b": { privateKey: null, publicKey: null, privateReadable: false },
        "~/.ssh/id_c": { privateKey: null, publicKey: "ssh-ed25519 CCCC c", privateReadable: true },
        "~/.ssh/id_d": { privateKey: null, publicKey: "ssh-ed25519 DDDD d", privateReadable: true },
      },
    });
    vi.mocked(importCtxOf).mockResolvedValue(newImportCtx({
      vault_id: "personal", tag: "", skipDupes: true, existingConnections: [],
      existingKeys: [{ id: "k1", name: "other", vault_id: "personal" } as never, { id: "k2", name: "id_c", vault_id: "personal" } as never],
      existingPublicKeys: new Map([["k1", "ssh-ed25519 AAAA a"]]),
      existingIdentities: [], existingSnippets: [], existingPfRules: [], existingFolders: [], stores: {} as never,
    }));
    const rows = await keyRows([
      { alias: "a", hostname: "a", port: 22, identityFile: "~/.ssh/id_a" },
      { alias: "a2", hostname: "a2", port: 22, identityFile: "~/.ssh/id_a" },
      { alias: "b", hostname: "b", port: 22, identityFile: "~/.ssh/id_b" },
      { alias: "c", hostname: "c", port: 22, identityFile: "~/.ssh/id_c" },
      { alias: "d", hostname: "d", port: 22, identityFile: "~/.ssh/id_d" },
    ], "personal");
    expect(rows).toEqual([
      { name: "id_a", path: "~/.ssh/id_a", state: { copy: "exists", ref: "exists" } },
      { name: "id_b", path: "~/.ssh/id_b", state: { copy: "unreadable", ref: "unreadable" } },
      { name: "id_c", path: "~/.ssh/id_c", state: { copy: "exists", ref: "notCopied" } },
      { name: "id_d", path: "~/.ssh/id_d", state: { copy: "copy", ref: "notCopied" } },
    ]);
    expect(readOpensshFiles).toHaveBeenCalledWith(["~/.ssh/id_a", "~/.ssh/id_b", "~/.ssh/id_c", "~/.ssh/id_d"], "probe");
  });
});

describe("user actions", () => {
  it("activate writes the switch and the chosen links", async () => {
    disk = JSON.stringify({ managed: { c9: { alias: "old", at: 1, gone: "detached", devices: {} } } });
    await activate({ links: [{ alias: "web", connectionId: "c1" }], ignored: [{ alias: "db", connectionId: "c2" }], creates: ["old"] }, "personal", false);
    const s = JSON.parse(disk!);
    expect(s.sync).toMatchObject({ on: true, vault: "personal", copyKeys: false });
    expect(s.managed.c1).toMatchObject({ alias: "web", devices: {} });
    expect(s.managed.c1.gone).toBeUndefined();
    expect(s.managed.c2).toMatchObject({ alias: "db", gone: "detached" });
    expect(s.managed.c9.gone).toBe("removed");
    expect(sshConfigSync.request).toHaveBeenCalledWith("switch");
  });

  it("activate marks this computer reviewed and links as linked, keeping an unchanged switch", async () => {
    disk = JSON.stringify({ sync: { on: true, vault: "personal", copyKeys: true, at: 5 }, joined: { d2: 5 } });
    await activate({ links: [{ alias: "web", connectionId: "c1" }], ignored: [], creates: [] }, "personal", true);
    const s = JSON.parse(disk!);
    expect(s.sync.at).toBe(5);
    expect(s.joined.d2).toBe(5);
    expect(s.joined.d1).toBeGreaterThanOrEqual(5);
    expect(s.managed.c1.linked).toBe(true);
    await activate({ links: [], ignored: [], creates: [] }, "personal", false);
    const changed = JSON.parse(disk!);
    expect(changed.sync).toMatchObject({ copyKeys: false });
    expect(changed.sync.at).toBeGreaterThan(5);
    expect(changed.joined.d1).toBe(changed.sync.at);
  });

  it("changeSync asks the other computers to review again, but not this one", async () => {
    disk = JSON.stringify({ sync: { on: true, vault: "personal", at: 5 }, joined: { d1: 5, d2: 5 } });
    await changeSync({ copyKeys: false });
    const s = JSON.parse(disk!);
    expect(s.sync).toMatchObject({ on: true, vault: "personal", copyKeys: false });
    expect(s.joined.d1).toBe(s.sync.at);
    expect(s.joined.d2).toBeLessThan(s.sync.at);
    expect(sshConfigSync.request).toHaveBeenCalledWith("switch");
  });

  it("activate turns a detached entry on a team-vault host into removed when its alias is created", async () => {
    disk = JSON.stringify({ managed: { t1: { alias: "web", at: 1, gone: "detached", devices: {} } } });
    vi.mocked(connApi.listConnections).mockResolvedValue([c("t1", "web", "1", "u", 22, "team-abc")]);
    await activate({ links: [], ignored: [], creates: ["web"] }, "personal", true);
    expect(JSON.parse(disk!).managed.t1.gone).toBe("removed");
  });

  it("activate unblocks every detached entry of an alias it promises to create", async () => {
    disk = JSON.stringify({ managed: { c1: { alias: "web", at: 1, gone: "detached", devices: {} }, c2: { alias: "web", at: 2, gone: "detached", devices: {} } } });
    await activate({ links: [], ignored: [], creates: ["web"] }, "personal", true);
    const s = JSON.parse(disk!).managed;
    expect([s.c1.gone, s.c2.gone]).toEqual(["removed", "removed"]);
  });

  it("activate makes a relinked entry re-apply on every device, and this one owns it", async () => {
    disk = JSON.stringify({ managed: { c1: { alias: "web", at: 1, gone: "detached", devices: { d2: { present: true, hash: "h", at: 1 } } } } });
    await activate({ links: [{ alias: "web", connectionId: "c1" }], ignored: [], creates: [] }, "personal", true);
    const { d1, d2 } = JSON.parse(disk!).managed.c1.devices;
    expect(d2).toMatchObject({ present: false, hash: "" });
    expect(d2.at).toBeGreaterThan(1);
    expect(d1).toMatchObject({ present: true, hash: "" });
  });

  it("linkAgain makes the revived entry re-apply on every device, and this one owns it", async () => {
    disk = JSON.stringify({ managed: { c1: { alias: "web", at: 1, gone: "detached", devices: { d2: { present: true, hash: "h", at: 1 } } } } });
    await linkAgain("c1");
    const e = JSON.parse(disk!).managed.c1;
    expect(e.devices.d2).toMatchObject({ present: false, hash: "" });
    expect(e.devices.d2.at).toBeGreaterThan(1);
    expect(e.devices.d1).toMatchObject({ present: true, hash: "" });
  });

  it("detach marks the given entries detached and leaves the others", async () => {
    disk = JSON.stringify({ managed: { c1: { alias: "web", at: 1, devices: {} }, c2: { alias: "db", at: 1, devices: {} } } });
    await detach(["c1"]);
    const s = JSON.parse(disk!);
    expect(s.managed.c1.gone).toBe("detached");
    expect(s.managed.c2.gone).toBeUndefined();
  });

  it("turnOff switches off and detaches every live entry", async () => {
    disk = JSON.stringify({ sync: { on: true, vault: "personal", copyKeys: false, at: 1 }, managed: { c1: { alias: "web", at: 1, devices: {} } } });
    await turnOff();
    const s = JSON.parse(disk!);
    expect(s.sync).toMatchObject({ on: false, copyKeys: false });
    expect(s.managed.c1.gone).toBe("detached");
  });

  it("linkAgain revives a detached entry", async () => {
    disk = JSON.stringify({ managed: { c1: { alias: "web", at: 1, gone: "detached", devices: {} } } });
    await linkAgain("c1");
    expect(JSON.parse(disk!).managed.c1.gone).toBeUndefined();
  });

  it("linkAgain on a deleted host unblocks its alias for recreation", async () => {
    disk = JSON.stringify({ managed: { c9: { alias: "old", at: 1, gone: "detached", devices: {} } } });
    await linkAgain("c9");
    expect(JSON.parse(disk!).managed.c9.gone).toBe("removed");
  });
});
