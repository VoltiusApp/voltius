import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";

// vi.mock factories are hoisted above top-level consts; vi.hoisted() hoists
// this mock fn alongside them so the factory below can reference it.
const { sseFetch } = vi.hoisted(() => ({
  sseFetch: vi.fn(async () => new Response("ok", { status: 200 })),
}));
vi.mock("@/services/sseFetch", () => ({ sseFetch }));

import { loadPlugin, unloadPlugin } from "./runtime";
import type { PluginManifest, PluginRegisterFn } from "./api";

function manifest(perms: string[]): PluginManifest {
  return { id: "t", name: "T", version: "1", permissions: perms };
}
let captured: import("./api").PluginAPI;
const register: PluginRegisterFn = (api) => { captured = api; };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { try { unloadPlugin("t"); } catch { /* noop */ } });

describe("http.stream", () => {
  test("with the http permission, delegates to sseFetch", async () => {
    loadPlugin(manifest(["http"]), register, true, false);
    const res = await captured.http.stream("https://x/y", { method: "POST" });
    expect(res.status).toBe(200);
    expect(sseFetch).toHaveBeenCalledWith("https://x/y", { method: "POST" });
  });

  test("without the http permission, throws before calling sseFetch", async () => {
    loadPlugin(manifest([]), register, true, false);
    await expect(captured.http.stream("https://x/y")).rejects.toThrow(/requires permission/);
    expect(sseFetch).not.toHaveBeenCalled();
  });
});
