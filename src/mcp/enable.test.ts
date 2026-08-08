import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn().mockResolvedValue("/home/u/.config/voltius/mcp.sock");
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { syncMcpServer } from "./enable";

beforeEach(() => invoke.mockClear());

describe("syncMcpServer", () => {
  it("starts the listener when enabled", async () => {
    await syncMcpServer(true);
    expect(invoke).toHaveBeenCalledWith("mcp_set_enabled", { enabled: true });
  });

  it("stops it when disabled — off by default means no socket exists", async () => {
    await syncMcpServer(false);
    expect(invoke).toHaveBeenCalledWith("mcp_set_enabled", { enabled: false });
  });

  it("propagates a backend failure so the caller can revert the toggle", async () => {
    invoke.mockRejectedValueOnce(new Error("bind failed"));
    await expect(syncMcpServer(true)).rejects.toThrow("bind failed");
  });
});
