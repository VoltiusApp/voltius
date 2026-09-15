import { describe, test, expect, vi } from "vitest";

const appLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("@/lib/logger", async (orig) => ({ ...(await orig<object>()), log: appLog }));

import { loadPlugin } from "./runtime";
import type { PluginAPI, PluginManifest, PluginRegisterFn } from "./api";

describe("api.log", () => {
  test("reaches the app log file, not only the webview console", () => {
    let api!: PluginAPI;
    const manifest: PluginManifest = { id: "agent-log", name: "agent-log", version: "1", permissions: [] };
    const register: PluginRegisterFn = (a) => { api = a; };
    loadPlugin(manifest, register, true, false);

    api.log.info("sync #1 start", { n: 1 });
    api.log.warn("careful");
    api.log.error("boom");

    expect(appLog.info).toHaveBeenCalledWith("[plugin:agent-log] sync #1 start", { n: 1 });
    expect(appLog.warn).toHaveBeenCalledWith("[plugin:agent-log] careful");
    expect(appLog.error).toHaveBeenCalledWith("[plugin:agent-log] boom");
  });
});
