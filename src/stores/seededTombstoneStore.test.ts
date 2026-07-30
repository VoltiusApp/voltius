import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), touch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("./appSettingsTimestampStore", () => ({
  useAppSettingsTimestampStore: { getState: () => ({ touch: h.touch }) },
}));

import { useSeededTombstoneStore } from "./seededTombstoneStore";

const FILE = "removed-seeded.json";

beforeEach(() => {
  vi.clearAllMocks();
  useSeededTombstoneStore.setState({ removed: [] });
});

test("load reads the persisted removed list", async () => {
  h.invoke.mockResolvedValue(JSON.stringify({ removed: ["plugin-docker"] }));
  await useSeededTombstoneStore.getState().load();
  expect(useSeededTombstoneStore.getState().isRemoved("plugin-docker")).toBe(true);
  expect(useSeededTombstoneStore.getState().isRemoved("plugin-ssh")).toBe(false);
});

test("load degrades to an empty list when the file is absent", async () => {
  h.invoke.mockRejectedValue(new Error("not found"));
  await useSeededTombstoneStore.getState().load();
  expect(useSeededTombstoneStore.getState().removed).toEqual([]);
});

test("load degrades to an empty list on a malformed (wrong-shape) file", async () => {
  h.invoke.mockResolvedValue(JSON.stringify(["plugin-docker"]));
  await useSeededTombstoneStore.getState().load();
  expect(useSeededTombstoneStore.getState().removed).toEqual([]);
});

test("remove adds the id, persists, and touches the settings timestamp", async () => {
  h.invoke.mockResolvedValue(undefined);
  await useSeededTombstoneStore.getState().remove("plugin-docker");

  expect(useSeededTombstoneStore.getState().isRemoved("plugin-docker")).toBe(true);
  expect(h.touch).toHaveBeenCalledOnce();
  expect(h.invoke).toHaveBeenCalledWith("plugin_write_file", {
    id: "__meta__",
    filename: FILE,
    content: JSON.stringify({ removed: ["plugin-docker"] }, null, 2),
  });
});

test("remove is idempotent — removing an already-removed id is a no-op", async () => {
  useSeededTombstoneStore.setState({ removed: ["plugin-docker"] });
  h.invoke.mockResolvedValue(undefined);

  await useSeededTombstoneStore.getState().remove("plugin-docker");

  expect(useSeededTombstoneStore.getState().removed).toEqual(["plugin-docker"]);
  expect(h.touch).not.toHaveBeenCalled();
  expect(h.invoke).not.toHaveBeenCalled();
});

test("restore removes the id, persists, and touches the settings timestamp", async () => {
  useSeededTombstoneStore.setState({ removed: ["plugin-docker"] });
  h.invoke.mockResolvedValue(undefined);

  await useSeededTombstoneStore.getState().restore("plugin-docker");

  expect(useSeededTombstoneStore.getState().isRemoved("plugin-docker")).toBe(false);
  expect(h.touch).toHaveBeenCalledOnce();
  expect(h.invoke).toHaveBeenCalledWith("plugin_write_file", {
    id: "__meta__",
    filename: FILE,
    content: JSON.stringify({ removed: [] }, null, 2),
  });
});

test("restore is idempotent — restoring an id that isn't removed is a no-op", async () => {
  h.invoke.mockResolvedValue(undefined);

  await useSeededTombstoneStore.getState().restore("plugin-docker");

  expect(h.touch).not.toHaveBeenCalled();
  expect(h.invoke).not.toHaveBeenCalled();
});
