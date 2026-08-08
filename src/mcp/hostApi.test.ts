import { describe, it, expect } from "vitest";
import { createHostPluginAPI } from "@/plugins/runtime";
import { buildMcpTools } from "./consumer";
import { PERMISSIONS } from "./hostApi";

/** Mirrors requirePerm/requireGated's thrown message in plugins/runtime.ts. */
const isPermissionError = (err: unknown) => err instanceof Error && /requires permission/.test(err.message);

describe("MCP host API surface", () => {
  it("builds all 14 MCP tools over the real createHostPluginAPI", () => {
    const api = createHostPluginAPI("__mcp_hostapi_test__", PERMISSIONS);
    expect(buildMcpTools(api).map((t) => t.name).sort()).toHaveLength(14);
  });

  // Each gated PluginAPI call the 14 tools reach into must clear its permission
  // check against PERMISSIONS. This is the same shape as two known past bugs:
  // terminal:write missing on the agent bundle, and the whileActive audit drop —
  // both invisible to tests that mock getMcpHostApi/PluginAPI instead of building
  // a real one.
  it("every gated call the tools make clears its permission check", async () => {
    const api = createHostPluginAPI("__mcp_hostapi_test2__", PERMISSIONS);

    const calls: Array<() => unknown> = [
      () => api.connections.list(),
      () => api.sessions.list(),
      () => api.sftp.list("local", "/"),
      () => api.sftp.stat("local", "/x"),
      () => api.sftp.readText("local", "/x"),
      () => api.sftp.mkdir("local", "/x"),
      () => api.sftp.writeText("local", "/x", "y"),
      () => api.sftp.rename("local", "/x", "/y"),
      () => api.sftp.delete("local", "/x"),
      () => api.sftp.transfer({ target: "local", path: "/x" }, { target: "local", path: "/y" }),
      () => api.sessions.open("c1"),
      () => api.sessions.sendCommand("s1", "echo hi"),
      () => api.terminal.onOutput("s1", () => {}),
      () => api.terminal.readSnapshot("s1"),
      () => api.sessions.close("s1"),
      () => api.audit.record("c1", "agent.command_run"),
    ];

    for (const call of calls) {
      try {
        await call();
      } catch (err) {
        expect(isPermissionError(err)).toBe(false);
      }
    }
  });
});
