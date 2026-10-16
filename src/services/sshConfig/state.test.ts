import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@/lib/invoke";
import { useSshConfigStore } from "@/stores/sshConfigStore";
import { applyRemoteSshConfigState, joinedHere, loadSshConfigState, mergeSshConfigState, updateSshConfigState } from "./state";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));
vi.mock("@/services/account", () => ({ isServerMode: async () => false }));

let disk: string | null = null;
beforeEach(() => {
  disk = null;
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "ssh_config_state_load") return disk;
    if (cmd === "ssh_config_state_save") disk = (args as { state: string }).state;
  });
});

describe("mergeSshConfigState", () => {
  it.each([
    [{}, {}, {}],
    [{ offer: "declined" }, { offer: "accepted" }, { offer: "declined" }],
    [{}, { offer: "accepted" }, { offer: "accepted" }],
    [{ migrated: { a: 1 } }, {}, { migrated: { a: 1 } }],
    [{ migrated: { a: 1 } }, { migrated: { a: 2, b: 1 } }, { migrated: { a: 2, b: 1 } }],
    [{ notice: "pending" }, { notice: "seen" }, { notice: "seen" }],
    [{ notice: "seen" }, { notice: "pending" }, { notice: "seen" }],
    [{}, { notice: "pending" }, { notice: "pending" }],
  ] as const)("%j + %j = %j", (a, b, out) => {
    expect(mergeSshConfigState(a, b)).toEqual(out);
  });
});

describe("mergeSshConfigState (corrupt entries)", () => {
  it("drops the old boolean migrated flag so every device migrates itself", () => {
    expect(mergeSshConfigState({ migrated: true } as never, {})).toEqual({});
  });

  it("drops entries and devices that are not objects", () => {
    const corrupt = { managed: { x: null, y: { alias: "web", at: 1, devices: { d1: null, d2: { present: true, hash: "h", at: 1 } } } } } as never;
    expect(mergeSshConfigState(corrupt, {})).toEqual({ managed: { y: { alias: "web", at: 1, devices: { d2: { present: true, hash: "h", at: 1 } } } } });
    expect(mergeSshConfigState({}, corrupt)).toEqual({ managed: { y: { alias: "web", at: 1, devices: { d2: { present: true, hash: "h", at: 1 } } } } });
  });

  it("loads a corrupt file without its non-object entries", async () => {
    disk = JSON.stringify({ managed: { x: null, y: { alias: "web", at: 1, devices: null } } });
    expect(await loadSshConfigState()).toEqual({ managed: { y: { alias: "web", at: 1, devices: {} } } });
    expect(useSshConfigStore.getState().state.managed).toEqual({ y: { alias: "web", at: 1, devices: {} } });
  });
});

describe("state file", () => {
  it("keeps every writer's entries when writes overlap", async () => {
    const entry = (alias: string) => ({ alias, at: 1, devices: {} });
    await Promise.all([
      updateSshConfigState({ managed: { c1: entry("web") } }),
      applyRemoteSshConfigState(JSON.stringify({ managed: { c2: entry("db") } })),
      updateSshConfigState({ managed: { c3: entry("ci") } }),
    ]);
    expect(Object.keys(JSON.parse(disk!).managed).sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("keeps the latest heartbeat of each device", () => {
    expect(mergeSshConfigState({ seen: { d1: 5, d2: 1 } }, { seen: { d1: 3, d3: 2 } })).toEqual({ seen: { d1: 5, d2: 1, d3: 2 } });
  });

  it("writes patches and keeps the answer once given", async () => {
    await updateSshConfigState({ offer: "accepted", migrated: { d: 1 }, notice: "pending" });
    await updateSshConfigState({ notice: "seen" });
    expect(JSON.parse(disk!)).toEqual({ offer: "accepted", migrated: { d: 1 }, notice: "seen" });
  });

  it("merges a remote copy without regressing", async () => {
    disk = JSON.stringify({ notice: "seen" });
    await applyRemoteSshConfigState(JSON.stringify({ offer: "declined", migrated: { d: 1 }, notice: "pending" }));
    expect(JSON.parse(disk!)).toEqual({ offer: "declined", migrated: { d: 1 }, notice: "seen" });
  });

  it("ignores a malformed remote copy", async () => {
    await applyRemoteSshConfigState("{nope");
    expect(disk).toBeNull();
  });
});

const entry = (alias: string, at: number, extra: Partial<import("./state").ManagedEntry> = {}) => ({ alias, at, devices: {}, ...extra });

describe("mergeSshConfigState, spec B fields", () => {
  it("lets the newest switch win, including back to off", () => {
    const on = { sync: { on: true, vault: "personal", at: 2 } };
    const off = { sync: { on: false, vault: "personal", at: 3 } };
    expect(mergeSshConfigState(on, off).sync).toEqual(off.sync);
    expect(mergeSshConfigState(off, on).sync).toEqual(off.sync);
  });

  it("takes alias and gone from the newer entry and merges devices per device", () => {
    const a = { managed: { c1: entry("web", 5, { gone: "detached", devices: { d1: { present: true, hash: "h1", at: 9 } } }) } };
    const b = { managed: { c1: entry("web", 4, { devices: { d1: { present: false, hash: "h0", at: 2 }, d2: { present: true, hash: "h2", at: 3 } } }) } };
    expect(mergeSshConfigState(a, b).managed!.c1).toEqual({
      alias: "web", at: 5, gone: "detached",
      devices: { d1: { present: true, hash: "h1", at: 9 }, d2: { present: true, hash: "h2", at: 3 } },
    });
  });

  it("lets the deleting computer's removal win over a newer guess from its tombstone", () => {
    const guess = { managed: { c1: entry("web", 9, { gone: "detached", tombstoned: true }) } };
    const removed = { managed: { c1: entry("web", 5, { gone: "removed" }) } };
    expect(mergeSshConfigState(guess, removed, 10).managed!.c1).toMatchObject({ at: 5, gone: "removed" });
    expect(mergeSshConfigState(removed, guess, 10).managed!.c1).toMatchObject({ at: 5, gone: "removed" });
    expect(mergeSshConfigState(guess, { managed: { c1: entry("web", 5) } }).managed!.c1).toMatchObject({ gone: "detached", tombstoned: true });
  });

  it("revives an entry when the newer side has no gone", () => {
    const a = { managed: { c1: entry("web", 1, { gone: "detached" as const }) } };
    const b = { managed: { c1: entry("web", 2) } };
    expect(mergeSshConfigState(a, b).managed!.c1.gone).toBeUndefined();
  });

  it("drops removed entries older than 30 days", () => {
    const now = 100 * 24 * 3600 * 1000;
    const old = { managed: { c1: entry("a", now - 31 * 24 * 3600 * 1000, { gone: "removed" as const }), c2: entry("b", now - 1, { gone: "removed" as const }) } };
    expect(Object.keys(mergeSshConfigState(old, {}, now).managed!)).toEqual(["c2"]);
  });

  it("keeps each device's latest review and a linked mark from either side", () => {
    const merged = mergeSshConfigState(
      { joined: { d1: 3 }, managed: { c1: entry("web", 5, { linked: true }) } },
      { joined: { d1: 1, d2: 4 }, managed: { c1: entry("web", 9) } },
    );
    expect(merged.joined).toEqual({ d1: 3, d2: 4 });
    expect(merged.managed!.c1).toMatchObject({ at: 9, linked: true });
  });

  it("counts a device as reviewed only for the switch it saw", () => {
    const sync = { on: true, vault: "personal", at: 5 };
    expect(joinedHere({ sync, joined: { d1: 5 } }, "d1")).toBe(true);
    expect(joinedHere({ sync, joined: { d1: 4 } }, "d1")).toBe(false);
    expect(joinedHere({ sync }, "d1")).toBe(false);
  });

  it("unions legacy aliases, local first", () => {
    expect(mergeSshConfigState({ legacyAliases: { web: "c1" } }, { legacyAliases: { web: "c9", db: "c2" } }).legacyAliases).toEqual({ web: "c1", db: "c2" });
  });

  it("does not throw on an entry without devices", () => {
    const broken = { managed: { c1: { alias: "web", at: 9 } as unknown as import("./state").ManagedEntry } };
    const normal = { managed: { c1: entry("web", 1, { devices: { d1: { present: true, hash: "h", at: 1 } } }) } };
    expect(mergeSshConfigState(broken, normal).managed!.c1.devices).toEqual({ d1: { present: true, hash: "h", at: 1 } });
    expect(mergeSshConfigState(normal, broken).managed!.c1.devices).toEqual({ d1: { present: true, hash: "h", at: 1 } });
  });

  it("keeps a detach when a stale patch arrives", async () => {
    disk = JSON.stringify({ managed: { c1: entry("web", 5, { gone: "detached" }) } });
    const merged = await updateSshConfigState({ managed: { c1: entry("web", 2) } });
    expect(merged.managed!.c1.gone).toBe("detached");
  });

  it("mirrors every load, update and remote apply into the store", async () => {
    const current = () => useSshConfigStore.getState().state;
    disk = JSON.stringify({ notice: "pending" });
    expect(await loadSshConfigState()).toEqual(current());
    const updated = await updateSshConfigState({ migrated: { d: 1 } });
    expect(current()).toEqual(updated);
    await applyRemoteSshConfigState(JSON.stringify({ offer: "accepted" }));
    expect(current()).toEqual(JSON.parse(disk!));
    expect(current().offer).toBe("accepted");
  });
});
