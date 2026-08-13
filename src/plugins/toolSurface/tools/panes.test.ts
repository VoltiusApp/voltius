import { describe, expect, it, vi } from "vitest";
import { buildPaneTools } from "./panes";
import type { ToolSurfacePorts } from "../coreTools";

const TAB = {
  tabId: "tab-1", kind: "split" as const, active: true, broadcastActive: false, layout: null,
  panes: [
    { paneId: "p-1", sessionId: "sess-a", connectionName: "web-01", active: true, maximized: false },
    { paneId: "p-2", sessionId: "sess-b", connectionName: "db-01", active: false, maximized: false },
  ],
};

function makePorts(over: Partial<ToolSurfacePorts> = {}) {
  const owned = new Set(["sess-a"]);
  const panes = {
    list: vi.fn(() => [TAB]),
    split: vi.fn(() => ({ ok: true as const, tab: TAB })),
    move: vi.fn(() => ({ ok: true as const, tab: TAB })),
    detach: vi.fn(() => ({ ok: true as const, tab: null })),
    focus: vi.fn(() => ({ ok: true as const, tab: TAB })),
  };
  const ports = {
    api: { panes } as unknown as ToolSurfacePorts["api"],
    approve: vi.fn(async ({ args }) => ({ approve: true as const, args, scope: "c1", via: "prompt" as const })),
    audit: vi.fn(),
    owned: { has: (id: string) => owned.has(id), add: (id: string) => owned.add(id), delete: (id: string) => owned.delete(id) },
    ...over,
  } as ToolSurfacePorts;
  return { ports, panes };
}

const tool = (ports: ToolSurfacePorts, name: string) => {
  const found = buildPaneTools(ports).find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

describe("pane tools", () => {
  it("exposes exactly the five pane verbs", () => {
    const { ports } = makePorts();
    expect(buildPaneTools(ports).map((t) => t.name)).toEqual([
      "pane_list", "pane_split", "session_move_to_pane", "pane_detach", "pane_focus",
    ]);
  });

  it("pane_list decorates each pane with ownedByCaller", async () => {
    const { ports } = makePorts();
    const result = await tool(ports, "pane_list").execute({});
    expect(result).toEqual({
      tabs: [{ ...TAB, panes: [
        { ...TAB.panes[0], ownedByCaller: true },
        { ...TAB.panes[1], ownedByCaller: false },
      ] }],
    });
  });

  it("pane_split refuses a source the caller does not own, before the gate", async () => {
    const { ports, panes } = makePorts();
    const result = await tool(ports, "pane_split")
      .execute({ sessionId: "sess-b", targetSessionId: "sess-a", position: "right" });
    expect(result).toMatchObject({ refused: true });
    expect(ports.approve).not.toHaveBeenCalled();
    expect(panes.split).not.toHaveBeenCalled();
  });

  it("pane_split passes an owned source through the gate to the API", async () => {
    const { ports, panes } = makePorts();
    const result = await tool(ports, "pane_split")
      .execute({ sessionId: "sess-a", targetSessionId: "sess-b", position: "bottom" });
    expect(panes.split).toHaveBeenCalledWith({ sessionId: "sess-a", targetSessionId: "sess-b", position: "bottom" });
    expect(result).toEqual({ ok: true, result: TAB });
  });

  it("turns a domain error into a refusal", async () => {
    const { ports, panes } = makePorts();
    panes.split.mockReturnValueOnce({ ok: false, error: "boom" } as never);
    const result = await tool(ports, "pane_split")
      .execute({ sessionId: "sess-a", targetSessionId: "sess-b", position: "right" });
    expect(result).toMatchObject({ refused: true, error: "boom" });
  });

  it("pane_focus accepts a session the caller does not own", async () => {
    const { ports, panes } = makePorts();
    await tool(ports, "pane_focus").execute({ sessionId: "sess-b", maximize: true });
    expect(panes.focus).toHaveBeenCalledWith("sess-b", true);
  });

  it("pane_detach requires ownership", async () => {
    const { ports, panes } = makePorts();
    expect(await tool(ports, "pane_detach").execute({ sessionId: "sess-b" })).toMatchObject({ refused: true });
    expect(panes.detach).not.toHaveBeenCalled();
  });

  it("rejects a bad position and a missing id at the schema", () => {
    const { ports } = makePorts();
    const schema = tool(ports, "pane_split").schema;
    expect(schema.safeParse({ sessionId: "a", targetSessionId: "b", position: "sideways" }).success).toBe(false);
    expect(schema.safeParse({ sessionId: "a", position: "right" }).success).toBe(false);
  });

  it("writes no audit rows: a layout change is not an audit event", async () => {
    const { ports } = makePorts();
    await tool(ports, "pane_split").execute({ sessionId: "sess-a", targetSessionId: "sess-b", position: "right" });
    await tool(ports, "pane_detach").execute({ sessionId: "sess-a" });
    expect(ports.audit).not.toHaveBeenCalled();
  });
});
