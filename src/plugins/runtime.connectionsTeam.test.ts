import { test, expect, vi, afterEach, beforeEach } from "vitest";

const connectionService = vi.hoisted(() => ({
  listConnections: vi.fn(async () => [] as unknown[]),
  saveConnection: vi.fn(async () => ({ id: "new" })),
  updateConnection: vi.fn(async () => {}),
  deleteConnection: vi.fn(async () => {}),
}));
vi.mock("@/services/connections", () => connectionService);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/hooks/useTerminal", () => ({
  readTerminalSnapshot: vi.fn(() => ""),
  readTerminalSelection: vi.fn(() => ""),
}));

import { loadPlugin, unloadPlugin } from "./runtime";
import { useConnectionStore } from "@/stores/connectionStore";
import { useTeamStore } from "@/stores/teamStore";
import type { PluginAPI, PluginManifest, PluginRegisterFn } from "./api";

const manifest: PluginManifest = {
  id: "t", name: "T", version: "1", permissions: ["connections:read", "connections:write"],
};
let captured: PluginAPI;
const register: PluginRegisterFn = (api) => { captured = api; };

function conn(id: string, host: string) {
  return { id, host, port: 22, username: "u", auth_type: "password", tags: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  connectionService.listConnections.mockResolvedValue([conn("personal-1", "p1")]);
  useConnectionStore.setState({
    connections: [conn("personal-1", "p1")],
    teamConnections: { "team-1": [conn("team-1-a", "t1")] },
  } as never);
  useTeamStore.setState({ teams: [{ id: "team-1", name: "Acme", role_ids: [] }] } as never);
});
afterEach(() => { try { unloadPlugin("t"); } catch { /* noop */ } });

test("list returns personal and team connections, flagging the team ones", async () => {
  await loadPlugin(manifest, register);
  const all = await captured.connections.list();
  expect(all.map((c) => c.id)).toEqual(["personal-1", "team-1-a"]);
  expect(all.find((c) => c.id === "personal-1")?.team).toBeUndefined();
  expect(all.find((c) => c.id === "team-1-a")?.team).toBe(true);
});

test("get resolves a team connection", async () => {
  await loadPlugin(manifest, register);
  expect((await captured.connections.get("team-1-a"))?.team).toBe(true);
});

// A team the user is no longer in can leave connections behind in the store;
// listing them would offer the agent a host it can no longer reach.
test("connections cached for a team the user left are not listed", async () => {
  useTeamStore.setState({ teams: [] } as never);
  await loadPlugin(manifest, register);
  expect((await captured.connections.list()).map((c) => c.id)).toEqual(["personal-1"]);
});

test("update and delete refuse a team connection without touching the personal store", async () => {
  await loadPlugin(manifest, register);
  await expect(captured.connections.update("team-1-a", { host: "x" })).rejects.toThrow(/team vault/);
  await expect(captured.connections.delete("team-1-a")).rejects.toThrow(/team vault/);
  expect(connectionService.updateConnection).not.toHaveBeenCalled();
  expect(connectionService.deleteConnection).not.toHaveBeenCalled();
});

test("update and delete still work on a personal connection", async () => {
  await loadPlugin(manifest, register);
  await captured.connections.update("personal-1", { host: "x" });
  await captured.connections.delete("personal-1");
  expect(connectionService.updateConnection).toHaveBeenCalled();
  expect(connectionService.deleteConnection).toHaveBeenCalledWith("personal-1");
});

test("subscribe emits the merged list", async () => {
  await loadPlugin(manifest, register);
  const cb = vi.fn();
  captured.connections.subscribe(cb);
  useConnectionStore.setState({ connections: [conn("personal-1", "p1"), conn("personal-2", "p2")] } as never);
  const calls = cb.mock.calls;
  const emitted = calls[calls.length - 1][0] as Array<{ id: string; team?: boolean }>;
  expect(emitted.map((c) => c.id)).toEqual(["personal-1", "personal-2", "team-1-a"]);
  expect(emitted.find((c) => c.id === "team-1-a")?.team).toBe(true);
});
