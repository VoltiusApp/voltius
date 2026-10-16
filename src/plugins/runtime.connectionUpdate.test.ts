// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach } from "vitest";
import type { PluginAPI, PluginManifest, PluginRegisterFn } from "./api";

const stored = {
  id: "c1",
  name: "Oracle",
  host: "oracle.example",
  port: 22,
  username: "ubuntu",
  auth_type: "key",
  tags: ["ssh-config"],
  identity_id: "i1",
  key_id: "k1",
  folder_id: "f1",
  vault_id: "personal",
  jump_hosts: [],
  env_vars: [{ id: "e1", key: "TZ", value: "UTC" }],
  agent_forwarding: true,
  legacy_algorithms: true,
  pre_command: "tmux a",
  post_command: "exit",
  pre_snippet_id: "sn1",
  post_snippet_id: "sn2",
  ask_vars_each_time: true,
  terminal_encoding: "utf-8",
  ping_disabled: true,
  shell_integration: "on",
  keepalive_preset: "aggressive",
  notes: "keep me",
};

const updateConnection = vi.fn(async (_id: string, _data: Record<string, unknown>) => {});
vi.mock("@/services/connections", () => ({
  listConnections: vi.fn(async () => [stored]),
  updateConnection: (id: string, data: Record<string, unknown>) => updateConnection(id, data),
  saveConnection: vi.fn(async () => stored),
}));

const { loadPlugin } = await import("./runtime");
const { useSshConfigStore } = await import("@/stores/sshConfigStore");

function load(id: string): PluginAPI {
  let api!: PluginAPI;
  const manifest: PluginManifest = { id, name: id, version: "1", permissions: ["connections:write"] };
  const register: PluginRegisterFn = (a) => { api = a; };
  loadPlugin(manifest, register, true, false);
  return api;
}

describe("api.connections.update", () => {
  beforeEach(() => updateConnection.mockClear());

  test("a partial update keeps every field it does not name", async () => {
    const api = load("agent-partial-update");
    await api.connections.update("c1", { host: "moved.example" });

    const [, payload] = updateConnection.mock.calls[0];
    expect(payload.host).toBe("moved.example");
    expect(payload).toMatchObject({
      folder_id: "f1",
      key_id: "k1",
      env_vars: stored.env_vars,
      agent_forwarding: true,
      legacy_algorithms: true,
      pre_command: "tmux a",
      post_command: "exit",
      pre_snippet_id: "sn1",
      post_snippet_id: "sn2",
      ask_vars_each_time: true,
      terminal_encoding: "utf-8",
      ping_disabled: true,
      shell_integration: "on",
      keepalive_preset: "aggressive",
    });
  });

  test("refuses to change owned fields of a host managed by ~/.ssh/config", async () => {
    useSshConfigStore.getState().setState({ managed: { c1: { alias: "web", at: 1, devices: {} } } });
    try {
      const api = load("agent-managed-guard");
      await expect(api.connections.update("c1", { host: "elsewhere" })).rejects.toThrow("Managed by ~/.ssh/config; detach it first");
      await expect(api.connections.update("c1", { name: "Renamed" })).resolves.toBeUndefined();
      await expect(api.connections.update("c1", { username: "me" })).resolves.toBeUndefined();
    } finally {
      useSshConfigStore.getState().setState({});
    }
  });
});
