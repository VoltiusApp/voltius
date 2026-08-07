import { describe, it, expect, beforeEach } from "vitest";
import { useHistoryStore } from "@/stores/historyStore";
import { pushCreateHistory, pushDeleteHistory } from "@/stores/recreateHistory";

function makeBackend() {
  const rows = new Map<string, { id: string; name: string }>();
  let n = 0;
  return {
    rows,
    create: async (data: { name: string }) => {
      const row = { id: `id-${++n}`, name: data.name };
      rows.set(row.id, row);
      return row;
    },
    remove: async (id: string) => {
      rows.delete(id);
    },
  };
}

describe("recreateHistory", () => {
  beforeEach(() => {
    useHistoryStore.setState({
      past: [],
      future: [],
      bypassing: false,
      suppressing: false,
      suppressDepth: 0,
      canUndo: false,
      canRedo: false,
    });
  });

  it("undoes and redoes a creation, tracking the new id across cycles", async () => {
    const backend = makeBackend();
    const created = await backend.create({ name: "a" });
    pushCreateHistory({
      label: "Created a",
      id: created.id,
      data: { name: "a" },
      create: backend.create,
      remove: backend.remove,
    });

    await useHistoryStore.getState().undo();
    expect([...backend.rows.keys()]).toEqual([]);

    await useHistoryStore.getState().redo();
    expect([...backend.rows.values()]).toEqual([{ id: "id-2", name: "a" }]);

    // The second undo must remove the *recreated* id, not the original one.
    await useHistoryStore.getState().undo();
    expect([...backend.rows.keys()]).toEqual([]);
  });

  it("undoes and redoes a deletion, tracking the new id across cycles", async () => {
    const backend = makeBackend();
    const created = await backend.create({ name: "b" });
    await backend.remove(created.id);
    pushDeleteHistory({
      label: "Deleted b",
      id: created.id,
      data: { name: "b" },
      create: backend.create,
      remove: backend.remove,
    });

    await useHistoryStore.getState().undo();
    expect([...backend.rows.values()]).toEqual([{ id: "id-2", name: "b" }]);

    await useHistoryStore.getState().redo();
    expect([...backend.rows.keys()]).toEqual([]);

    await useHistoryStore.getState().undo();
    expect([...backend.rows.values()]).toEqual([{ id: "id-3", name: "b" }]);
  });

  it("keeps each entry's recreated id separate", async () => {
    const backend = makeBackend();
    const first = await backend.create({ name: "x" });
    const second = await backend.create({ name: "y" });
    for (const row of [first, second]) {
      pushCreateHistory({
        label: `Created ${row.name}`,
        id: row.id,
        data: { name: row.name },
        create: backend.create,
        remove: backend.remove,
      });
    }

    await useHistoryStore.getState().undo();
    await useHistoryStore.getState().undo();
    expect([...backend.rows.keys()]).toEqual([]);

    await useHistoryStore.getState().redo();
    await useHistoryStore.getState().redo();
    expect([...backend.rows.values()].map((r) => r.name)).toEqual(["x", "y"]);
  });
});
