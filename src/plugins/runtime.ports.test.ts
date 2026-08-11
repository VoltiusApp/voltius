import { describe, test, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }));

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { loadPlugin, unloadPlugin } from "./runtime";
import type { PluginManifest, PluginRegisterFn, PluginAPI } from "./api";

function manifest(perms: string[]): PluginManifest {
  return { id: "t", name: "T", version: "1", permissions: perms };
}

let captured: PluginAPI;
const register: PluginRegisterFn = (api) => { captured = api; };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { try { unloadPlugin("t"); } catch { /* noop */ } });

describe("api.ports.reach", () => {
  test("a plugin without ports:forward is rejected", async () => {
    loadPlugin(manifest(["docker:read"]), register, true, false);
    await expect(
      captured.ports.reach({ sessionId: "s1", isRemote: false, hostPort: 8080, action: "browser" }),
    ).rejects.toThrow(/requires permission "ports:forward"/);
  });

  test("a local target opens the browser without opening a tunnel", async () => {
    loadPlugin(manifest(["ports:forward"]), register, true, false);
    const r = await captured.ports.reach({ sessionId: "s1", isRemote: false, hostPort: 8080, action: "browser" });
    expect(r.address).toBe("http://localhost:8080");
    expect(openUrl).toHaveBeenCalledWith("http://localhost:8080");
    expect(invoke).not.toHaveBeenCalledWith("pf_tunnel_open", expect.anything());
  });

  test("a remote target opens a tunnel through pf_tunnel_open", async () => {
    (invoke as Mock).mockImplementation(async (cmd: string) => {
      if (cmd === "pf_get_state") return { tunnels: [], suppressed_ports: [] };
      if (cmd === "pf_tunnel_open") {
        return {
          id: "t1",
          tunnel_type: "local",
          local_port: 18080,
          remote_port: 8080,
          remote_host: "127.0.0.1",
          origin: { type: "ad_hoc" },
          state: "active",
          bytes_transferred: 0,
        };
      }
      return undefined;
    });
    loadPlugin(manifest(["ports:forward"]), register, true, false);
    const r = await captured.ports.reach({ sessionId: "s1", isRemote: true, hostPort: 8080, action: "browser" });
    expect(r).toMatchObject({ localPort: 18080, tunneled: true });
    expect(openUrl).toHaveBeenCalledWith("http://localhost:18080");
  });

  test("the copy action writes the address to the clipboard and opens no browser", async () => {
    loadPlugin(manifest(["ports:forward"]), register, true, false);
    const r = await captured.ports.reach({ sessionId: "s1", isRemote: false, hostPort: 5432, action: "copy" });
    expect(r.address).toBe("localhost:5432");
    expect(writeText).toHaveBeenCalledWith("localhost:5432");
    expect(openUrl).not.toHaveBeenCalled();
  });
});
