import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  saveTeamVaultObject: vi.fn(),
  listConnections: vi.fn(async () => [] as unknown[]),
  updateConnection: vi.fn(async () => {}),
}));

vi.mock("@/services/teamObjectPersistence", () => ({
  saveTeamVaultObject: h.saveTeamVaultObject,
  removeTeamVaultObject: vi.fn(async () => {}),
}));
vi.mock("@/services/connections", () => ({
  listConnections: h.listConnections,
  updateConnection: h.updateConnection,
}));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));
vi.mock("@/services/account", () => ({ isServerMode: vi.fn(async () => false) }));
vi.mock("@/services/auditMutations", () => ({ reportAuditMutation: vi.fn() }));

import { useConnectionStore } from "./connectionStore";
import type { Connection } from "@/types";

const conn = (id: string, over: Partial<Connection> = {}): Connection => ({
  id, name: id, host: "h", port: 22, username: "u", auth_type: "key", tags: [], vault_id: "t1",
  created_at: "t0", updated_at: "t0", last_used_at: null, clocks: {}, ...over,
} as Connection);

const teamConn = (id: string) => useConnectionStore.getState().teamConnections.t1.find((c) => c.id === id);

beforeEach(() => {
  vi.clearAllMocks();
  useConnectionStore.setState({
    connections: [],
    teamConnections: { t1: [conn("tagged", { tags: ["old", "keep"] }), conn("other")] },
  });
});

// The team saves are network calls; anything the user does meanwhile must survive them.
async function whileSavesPending(action: () => Promise<void>, meanwhile: () => void): Promise<void> {
  let release!: () => void;
  const pending = new Promise<void>((r) => { release = r; });
  h.saveTeamVaultObject.mockImplementation(() => pending);
  const running = action();
  await vi.waitFor(() => expect(h.saveTeamVaultObject).toHaveBeenCalled());
  meanwhile();
  release();
  await running;
}

function concurrentEdits(): void {
  useConnectionStore.setState((s) => ({
    teamConnections: {
      t1: [...s.teamConnections.t1.map((c) => (c.id === "other" ? { ...c, name: "edited" } : c)), conn("created")],
    },
  }));
}

test("renameTag keeps team connections created or edited while its saves are in flight", async () => {
  await whileSavesPending(() => useConnectionStore.getState().renameTag("old", "new"), concurrentEdits);

  expect(teamConn("tagged")?.tags).toEqual(["new", "keep"]);
  expect(teamConn("other")?.name).toBe("edited");
  expect(teamConn("created")).toBeDefined();
  expect(h.saveTeamVaultObject).toHaveBeenCalledOnce();
});

test("deleteTag keeps team connections created or edited while its saves are in flight", async () => {
  await whileSavesPending(() => useConnectionStore.getState().deleteTag("old"), concurrentEdits);

  expect(teamConn("tagged")?.tags).toEqual(["keep"]);
  expect(teamConn("other")?.name).toBe("edited");
  expect(teamConn("created")).toBeDefined();
  expect(h.saveTeamVaultObject).toHaveBeenCalledOnce();
});
