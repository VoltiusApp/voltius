import { describe, test, expect, vi, beforeEach } from "vitest";
import { isAlive, mergeEntities } from "@/services/crdt";

const disk = vi.hoisted(() => ({ items: [] as Array<Record<string, unknown>>, failPut: false }));

vi.mock("@/lib/invoke", () => ({
  invoke: vi.fn(async (cmd: string, args?: { entry: Record<string, unknown> }) => {
    if (cmd === "favorite_command_list") return structuredClone(disk.items);
    if (cmd === "favorite_command_put") {
      if (disk.failPut) throw new Error("disk full");
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

import { useFavoriteCommandStore, type FavoriteCommand } from "./favoriteCommandStore";
import { syncAfterEdit } from "@/stores/syncAfterEdit";

const store = () => useFavoriteCommandStore.getState();

describe("favoriteCommandStore", () => {
  beforeEach(() => {
    disk.items = [];
    disk.failPut = false;
    useFavoriteCommandStore.setState({ favorites: [] });
    vi.mocked(syncAfterEdit).mockClear();
  });

  test("starring saves the command with its host and schedules a sync under the snippet type", async () => {
    await store().add("ls -la", "c1", "prod");
    expect(store().favorites).toMatchObject([{ command: "ls -la", connection_id: "c1", session_name: "prod" }]);
    expect(disk.items).toHaveLength(1);
    expect(syncAfterEdit).toHaveBeenCalledWith("snippet", store().favorites[0].id);
  });

  test("the same command on the same host is one favorite; on another host it is a second one", async () => {
    await store().add("ls", "c1", "prod");
    await store().add("ls", "c1", "prod");
    await store().add("ls", "c2", "web");
    expect(store().favorites).toHaveLength(2);
    useFavoriteCommandStore.setState({ favorites: [] });
    await store().add("ls", "c1", "renamed");
    expect(disk.items).toHaveLength(2);
  });

  test("removing keeps a tombstone on disk so the deletion syncs", async () => {
    await store().add("ls", "c1", "prod");
    const { id } = store().favorites[0];
    await store().remove(id);
    expect(store().favorites).toEqual([]);
    const tomb = disk.items[0] as unknown as FavoriteCommand;
    expect(tomb.deleted_at).toBeTruthy();
    expect(isAlive(tomb)).toBe(false);
    await store().load();
    expect(store().favorites).toEqual([]);
  });

  test("starring again after a removal survives a merge with another device's tombstone", async () => {
    await store().add("ls", "c1", "prod");
    await store().remove(store().favorites[0].id);
    const remoteTombstone = structuredClone(disk.items[0]) as unknown as FavoriteCommand;
    await new Promise((r) => setTimeout(r, 5));
    await store().add("ls", "c1", "prod");
    const merged = mergeEntities(disk.items as unknown as FavoriteCommand[], [remoteTombstone]);
    expect(merged.filter(isAlive)).toHaveLength(1);
  });

  test("a failed write reloads from disk instead of showing an unsaved favorite", async () => {
    disk.failPut = true;
    await expect(store().add("ls", "c1", "prod")).rejects.toThrow("disk full");
    expect(store().favorites).toEqual([]);
  });

  test("load lists the newest favorite first", async () => {
    await store().add("first", "c1", "prod");
    await new Promise((r) => setTimeout(r, 5));
    await store().add("second", "c1", "prod");
    await store().load();
    expect(store().favorites.map((f) => f.command)).toEqual(["second", "first"]);
  });
});
