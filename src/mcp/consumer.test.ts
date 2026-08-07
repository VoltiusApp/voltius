import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { buildMcpTools, listToolDescriptors, callTool } from "./consumer";
import * as toolSurface from "@voltius/tools";

const api = () => ({
  connections: { list: vi.fn().mockResolvedValue([{ id: "c1", name: "Prod", host: "h1", team: true }]) },
  sessions: { list: vi.fn().mockReturnValue([{ id: "s1", type: "ssh", status: "connected", connectionId: "c1" }]) },
  audit: { record: vi.fn() },
}) as never;

describe("MCP consumer", () => {
  it("exposes exactly the two pure-listing tools, not the full auto-risk tier", () => {
    // An explicit allowlist, not risk === "auto": the auto tier also carries
    // read_file/read_terminal, which reach arbitrary host files/terminal buffers.
    const names = buildMcpTools(api()).map((t) => t.name).sort();
    expect(names).toEqual(["list_connections", "list_sessions"]);
  });

  it("every exposed tool is still risk: auto, so the allowlist can never admit a prompt-risk verb", () => {
    const names = new Set(buildMcpTools(api()).map((t) => t.name));
    const autoNames = new Set(
      toolSurface
        .buildCoreTools({
          api: api(),
          approve: async () => ({ approve: true, scope: "mcp", via: "granted" }),
          audit: () => {},
          owned: new Set(),
        } as never)
        .filter((t) => t.risk === "auto")
        .map((t) => t.name),
    );
    for (const name of names) expect(autoNames.has(name)).toBe(true);
  });

  it("converts each tool's zod schema to a JSON Schema object for tools/list", () => {
    const [first] = listToolDescriptors(buildMcpTools(api()));
    // `{ type: "object" }` alone is satisfied by a raw zod schema too — ZodObject
    // exposes its own `.type` getter — so it can't distinguish "converted" from
    // "not converted". `$schema` and a plain-object `properties` only exist on the
    // real z.toJSONSchema() output.
    const schema = first.inputSchema as { $schema?: string; properties?: unknown };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(Object.getPrototypeOf(schema.properties ?? {})).toBe(Object.prototype);
    expect(first.inputSchema).not.toBeInstanceOf(z.ZodType);
    expect(typeof first.description).toBe("string");
    expect(first.description.length).toBeGreaterThan(0);
  });

  it("runs a tool and returns its real result", async () => {
    const tools = buildMcpTools(api());
    const out = await callTool(tools, "list_connections", {});
    expect(out).toEqual({ ok: true, result: [{ id: "c1", name: "Prod", host: "h1", team: true }] });
  });

  it("reports an unknown tool rather than throwing", async () => {
    const out = await callTool(buildMcpTools(api()), "rm_rf", {});
    expect(out).toEqual({ ok: false, error: 'unknown tool "rm_rf"' });
  });

  it("turns a throwing tool into an error result, so one bad call cannot kill the connection", async () => {
    const broken = api() as unknown as { connections: { list: () => Promise<unknown> } };
    broken.connections.list = () => Promise.reject(new Error("vault locked"));
    const out = await callTool(buildMcpTools(broken as never), "list_connections", {});
    expect(out).toEqual({ ok: false, error: "vault locked" });
  });

  // Settled design: Voltius performs no per-call check for MCP; the MCP client's
  // own permission prompt is the gate. A mock `approve` passed on the test's `api`
  // object cannot observe this, because buildMcpTools builds its own `approve`
  // closure internally and never reads one off `api`. So this spies on the real
  // `buildCoreTools` call buildMcpTools makes, wraps the real `ports.approve` it
  // constructs, and asserts that wrapper is never invoked while running every
  // auto-risk tool — pinning the port itself, not a substitute.
  it("never reaches the approval port: Voltius raises no card, the MCP client is the gate", async () => {
    const approveSpy = vi.fn();
    const original = toolSurface.buildCoreTools;
    vi.spyOn(toolSurface, "buildCoreTools").mockImplementation((ports) =>
      original({
        ...ports,
        approve: (call) => {
          approveSpy();
          return ports.approve(call);
        },
      }),
    );

    const tools = buildMcpTools(api());
    for (const t of tools) await t.execute({}).catch(() => {});

    expect(approveSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
