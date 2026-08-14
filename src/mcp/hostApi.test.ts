import { describe, it, expect } from "vitest";
import { createHostPluginAPI } from "@/plugins/runtime";
import { buildMcpTools } from "./consumer";
import { PERMISSIONS } from "./hostApi";

/** Mirrors requirePerm/requireGated's thrown message in plugins/runtime.ts. */
const isPermissionError = (err: unknown) => err instanceof Error && /requires permission/.test(err.message);

describe("MCP host API surface", () => {
  it("builds all 91 MCP tools over the real createHostPluginAPI", () => {
    const api = createHostPluginAPI("__mcp_hostapi_test__", PERMISSIONS);
    expect(buildMcpTools(api, new Set()).map((t) => t.name).sort()).toHaveLength(91);
  });

  // Each gated PluginAPI call the tools reach into must clear its permission
  // check against PERMISSIONS. This is the same shape as two known past bugs:
  // terminal:write missing on the agent bundle, and the whileActive audit drop —
  // both invisible to tests that mock getMcpHostApi/PluginAPI instead of building
  // a real one.
  it("every gated call the tools make clears its permission check", async () => {
    const api = createHostPluginAPI("__mcp_hostapi_test2__", PERMISSIONS);

    const calls: Array<() => unknown> = [
      () => api.connections.list(),
      () => api.connections.get("c1"),
      () => api.connections.create({ host: "h", port: 22, username: "u", auth_type: "key", tags: [] }),
      () => api.connections.update("c1", { username: "u2" }),
      () => api.connections.delete("c1"),
      () => api.connections.bulkImport([{ host: "h", port: 22, username: "u", auth_type: "key", tags: [] }]),
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
      () => api.sessions.sendInput("s1", "x"),
      () => api.terminal.onOutput("s1", () => {}),
      () => api.terminal.appCursorMode("s1"),
      () => api.terminal.readSnapshot("s1"),
      () => api.sessions.close("s1"),
      () => api.keys.list(),
      () => api.keys.create({ name: "test", key_type: "ed25519", tags: [] }, "private", "public"),
      () => api.keys.delete("k1"),
      () => api.identities.list(),
      () => api.identities.create({ username: "test", key_id: "k1", tags: [] }),
      () => api.identities.delete("i1"),
      () => api.audit.record("c1", "agent.command_run"),
      () => api.audit.query({}),
    ];

    for (const call of calls) {
      try {
        await call();
      } catch (err) {
        expect(isPermissionError(err)).toBe(false);
      }
    }
  });

  // export_objects/import_objects only reach api.fs when a `path` argument is
  // given; the two checks above run every tool with `{}` and so never exercise
  // that branch. A permission gap reached only through an optional argument
  // (the "fs" permission for IMPORT_EXPORT_PERMISSIONS) is invisible to them.
  it("export_objects and import_objects with a path do not hit a permission error", async () => {
    const api = createHostPluginAPI("__mcp_hostapi_test3__", PERMISSIONS);
    const tools = buildMcpTools(api, new Set());
    const exportTool = tools.find((t) => t.name === "export_objects");
    const importTool = tools.find((t) => t.name === "import_objects");
    expect(exportTool).toBeDefined();
    expect(importTool).toBeDefined();

    for (const call of [
      () => exportTool!.execute({ path: "export-bundle.json" }),
      () => importTool!.execute({ path: "export-bundle.json" }),
    ]) {
      let thrown: unknown;
      let result: unknown;
      try {
        result = await call();
      } catch (err) {
        thrown = err;
      }
      // Assertions live outside the try/catch: an assertion failure inside it
      // would itself be caught and re-checked against isPermissionError,
      // silently passing instead of failing the test.
      if (thrown !== undefined) expect(isPermissionError(thrown)).toBe(false);
      const errMsg =
        result && typeof result === "object" && typeof (result as { error?: unknown }).error === "string"
          ? (result as { error: string }).error
          : undefined;
      if (errMsg !== undefined) expect(isPermissionError(new Error(errMsg))).toBe(false);
    }
  });

  // Self-maintaining version of the check above: enumerates the real tool
  // list instead of a hand-copied one, so a new verb reaching an undeclared
  // permission fails this test even if nobody remembers to update the array.
  //
  // objectOp/makeFileOp catch their run() and return `{ error }` instead of
  // rejecting, so a rejection-only check would never see those tools' failures.
  // Both the thrown and the swallowed-into-`{error}` shapes are checked.
  it("no tool reaches a permission PERMISSIONS does not declare", async () => {
    const api = createHostPluginAPI("__perm_probe__", PERMISSIONS);
    const tools = buildMcpTools(api, new Set());
    for (const t of tools) {
      let thrown: unknown;
      let result: unknown;
      try {
        result = await t.execute({});
      } catch (err) {
        thrown = err;
      }
      // Assertions live outside the try/catch: an assertion failure inside it
      // would itself be caught and re-checked against isPermissionError,
      // silently passing instead of failing the test.
      if (thrown !== undefined) expect(isPermissionError(thrown)).toBe(false);
      const errMsg =
        result && typeof result === "object" && typeof (result as { error?: unknown }).error === "string"
          ? (result as { error: string }).error
          : undefined;
      if (errMsg !== undefined) expect(isPermissionError(new Error(errMsg))).toBe(false);
    }
  });
});
