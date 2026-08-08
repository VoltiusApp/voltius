import { describe, test, expect, vi } from "vitest";
import type { PluginAPI, PluginManifest, PluginRegisterFn } from "./api";

const saveConnection = vi.fn(async (data: Record<string, unknown>) => ({ id: "new", ...data }));
vi.mock("@/services/connections", () => ({
  saveConnection: (data: Record<string, unknown>) => saveConnection(data),
  listConnections: vi.fn(async () => []),
}));

const { loadPlugin } = await import("./runtime");

function manifest(id: string, perms: string[]): PluginManifest {
  return { id, name: id, version: "1", permissions: perms };
}

function load(id: string, perms: string[]): PluginAPI {
  let api!: PluginAPI;
  const register: PluginRegisterFn = (a) => { api = a; };
  loadPlugin(manifest(id, perms), register, true, false);
  return api;
}

describe("api.connections.bulkImport", () => {
  test("forwards identity_id and jump_hosts, matching single-item create", async () => {
    const api = load("agent", ["connections:write"]);
    const jumpHosts = [{ id: "j1", connection_id: "jc1" }];
    await api.connections.bulkImport([
      {
        host: "h", port: 22, username: "u", auth_type: "key", tags: [],
        identity_id: "i1", jump_hosts: jumpHosts,
      },
    ]);
    expect(saveConnection).toHaveBeenCalledWith(expect.objectContaining({
      identity_id: "i1",
      jump_hosts: jumpHosts,
    }));
  });
});
