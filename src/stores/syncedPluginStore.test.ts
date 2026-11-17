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
