import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { isAlive, mergeEntities } from "@/services/crdt";

const disk = vi.hoisted(() => ({ items: [] as Array<Record<string, unknown>> }));
const device = vi.hoisted(() => ({ id: "dev-a" }));
const prefs = vi.hoisted(() => ({ excluded: [] as string[] }));

vi.mock("@/lib/invoke", () => ({
  invoke: vi.fn(async (cmd: string, args?: { entry: Record<string, unknown> }) => {
    if (cmd === "raw_entity_list") return structuredClone(disk.items);
    if (cmd === "raw_entity_put") {
      const entry = structuredClone(args!.entry);
      const i = disk.items.findIndex((it) => it.id === entry.id);
      if (i >= 0) disk.items[i] = entry;
      else disk.items.push(entry);
      return undefined;
    }
    throw new Error(`unexpected ${cmd}`);
  }),
}));
vi.mock("@/stores/syncAfterEdit", () => ({ syncAfterEdit: vi.fn() }));
vi.mock("@/services/sync", () => ({ getDeviceId: vi.fn(async () => device.id) }));
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: { getState: () => ({ isExcluded: (id: string) => prefs.excluded.includes(id) }) },
}));

import { useSyncedPluginStore, type SyncedPlugin, type SyncedPluginFields } from "./syncedPluginStore";
import { syncAfterEdit } from "@/stores/syncAfterEdit";
import { serialMerge } from "@/services/serialMerge";

const store = () => useSyncedPluginStore.getState();
const fields: SyncedPluginFields = {
  repo: "acme/tool",
  source_id: "tool",
  hash: "h1",
  css_hash: null,
  permissions: ["host:exec"],
  name: "Tool",
};

const advance = (ms = 1000) => vi.setSystemTime(new Date(Date.now() + ms));

describe("syncedPluginStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T10:00:00.000Z"));
    disk.items = [];
    device.id = "dev-a";
    prefs.excluded = [];
    useSyncedPluginStore.setState({ entries: [] });
    vi.mocked(syncAfterEdit).mockClear();
  });

  afterEach(() => vi.useRealTimers());

  test("recordInstall writes a live entry with real clocks", async () => {
    await store().recordInstall("p1", fields);
    const entry = store().live("p1")!;
    expect(entry).toMatchObject({ ...fields, device_id: "dev-a" });
    expect(entry.installed_at).toBe("2026-11-17T10:00:00.000Z");
    expect(entry.clocks.repo).toBe(entry.updated_at);
    expect(entry.clocks.permissions).toBe(entry.updated_at);
    expect(disk.items).toHaveLength(1);
    expect(syncAfterEdit).toHaveBeenCalledWith("plugin", "p1");
  });

  test("recordInstall is a no-op when a live entry exists", async () => {
    await store().recordInstall("p1", fields);
    vi.mocked(syncAfterEdit).mockClear();
    advance();
    await store().recordInstall("p1", { ...fields, hash: "h2" });
    expect(store().live("p1")!.hash).toBe("h1");
    expect(syncAfterEdit).not.toHaveBeenCalled();
  });

  test("a forced recordInstall rewrites a stale live entry so it beats an older remote removal", async () => {
    await store().recordInstall("p1", fields);
    const stale = structuredClone(store().live("p1")!);
    const removedAt = new Date(Date.now() + 500).toISOString();
    const remote: SyncedPlugin = {
      ...stale,
      device_id: "dev-b",
      updated_at: removedAt,
      deleted_at: removedAt,
      clocks: { ...stale.clocks, __deleted__: removedAt },
    };
    vi.mocked(syncAfterEdit).mockClear();
    advance();

    await store().recordInstall("p1", { ...fields, hash: "h2" }, { force: true });

    const fresh = store().live("p1")!;
    expect(fresh.hash).toBe("h2");
    expect(syncAfterEdit).toHaveBeenCalledWith("plugin", "p1");
    expect(isAlive(mergeEntities([stale], [remote])[0])).toBe(false);
    expect(isAlive(mergeEntities([fresh], [remote])[0])).toBe(true);
  });

  test("a put waits for an in-flight merge before writing", async () => {
    let release = () => {};
    const merging = serialMerge(() => new Promise<void>((r) => (release = r)));

    const recording = store().recordInstall("p1", fields);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(disk.items).toHaveLength(0);

    release();
    await merging;
    await recording;
    expect(disk.items).toHaveLength(1);
  });

  test("recordUninstall tombstones a live entry and is a no-op for excluded ids", async () => {
    await store().recordInstall("p1", fields);
    await store().recordInstall("p2", fields);
    prefs.excluded = ["p2"];
    advance();
    await store().recordUninstall("p1");
    await store().recordUninstall("p2");
    expect(store().live("p1")).toBeUndefined();
    expect(store().entries.find((e) => e.id === "p1")!.deleted_at).toBeDefined();
    expect(store().live("p2")).toBeDefined();
  });

  test("reinstall after removal revives", async () => {
    await store().recordInstall("p1", fields);
    advance();
    await store().recordUninstall("p1");
    const tombstone = structuredClone(store().entries[0]);
    advance();
    await store().recordInstall("p1", fields);
    const revived = store().entries.find((e) => e.id === "p1")!;
    expect(isAlive(revived)).toBe(true);
    const [merged] = mergeEntities([revived], [tombstone]);
    expect(isAlive(merged)).toBe(true);
  });

  test("seed loses to a remote removal", async () => {
    await store().seed([{ id: "p1", ...fields }]);
    const seeded = store().entries[0];
    expect(seeded).toMatchObject({ clocks: {}, updated_at: "" });
    expect(seeded.deleted_at).toBeUndefined();
    const remote: SyncedPlugin = {
      ...seeded,
      device_id: "dev-b",
      installed_at: "2026-11-17T09:00:00.000Z",
      updated_at: "2026-11-17T11:00:00.000Z",
      deleted_at: "2026-11-17T11:00:00.000Z",
      clocks: { __deleted__: "2026-11-17T11:00:00.000Z" },
    };
    const [merged] = mergeEntities([seeded], [remote]);
    expect(isAlive(merged)).toBe(false);
  });

  test("seed never overwrites an existing entry", async () => {
    await store().recordInstall("p1", fields);
    advance();
    await store().recordUninstall("p1");
    const before = structuredClone(store().entries);
    await store().seed([
      { id: "p1", ...fields, name: "Other" },
      { id: "p3", ...fields },
    ]);
    expect(store().entries.find((e) => e.id === "p1")).toEqual(before[0]);
    expect(store().entries.map((e) => e.id).sort()).toEqual(["p1", "p3"]);
  });

  test("concurrent installs converge", async () => {
    await store().recordInstall("p1", fields);
    const a = structuredClone(store().entries[0]);
    useSyncedPluginStore.setState({ entries: [] });
    device.id = "dev-b";
    advance(5);
    await store().recordInstall("p1", { ...fields, hash: "h2" });
    const b = structuredClone(store().entries[0]);
    const ab = mergeEntities([a], [b]);
    const ba = mergeEntities([b], [a]);
    expect(ab).toEqual(ba);
    expect(isAlive(ab[0])).toBe(true);
  });
});
