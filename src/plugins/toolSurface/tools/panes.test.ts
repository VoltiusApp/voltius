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
    rename: vi.fn(() => ({ ok: true as const, tab: TAB })),
    renameTab: vi.fn(() => ({ ok: true as const, tab: TAB })),
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
  it("exposes exactly the seven pane verbs", () => {
    const { ports } = makePorts();
    expect(buildPaneTools(ports).map((t) => t.name)).toEqual([
      "pane_list", "pane_split", "session_move_to_pane", "pane_detach", "pane_focus",
      "pane_rename", "tab_rename",
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
    await tool(ports, "pane_rename").execute({ sessionId: "sess-a", title: "x" });
    expect(ports.audit).not.toHaveBeenCalled();
  });

  it("uses a consumer's not-owned error in pane_detach", async () => {
    const { ports } = makePorts({ text: { notOwnedError: "not yours" } });
    const result = await tool(ports, "pane_detach").execute({ sessionId: "sess-b" });
    expect(result).toMatchObject({ refused: true, error: "not yours" });
  });

  it("pane_focus documents that maximize needs a split tab", () => {
    const { ports } = makePorts();
    expect(tool(ports, "pane_focus").description).toContain("maximize");
    expect(tool(ports, "pane_focus").description).toMatch(/not in a split tab/);
  });

  it("a pane write adopts through acquire when the double provides one", async () => {
    const acquire = vi.fn(() => true);
    const { ports, panes } = makePorts();
    const withAcquire = { ...ports, owned: { ...ports.owned, acquire } } as ToolSurfacePorts;
    await tool(withAcquire, "pane_detach").execute({ sessionId: "orphan" });
    expect(acquire).toHaveBeenCalledWith("orphan");
    expect(panes.detach).toHaveBeenCalledWith("orphan");
  });

  it("pane_list never adopts", async () => {
    const acquire = vi.fn(() => true);
    const { ports } = makePorts();
    const withAcquire = { ...ports, owned: { ...ports.owned, acquire } } as ToolSurfacePorts;
    await tool(withAcquire, "pane_list").execute({});
    expect(acquire).not.toHaveBeenCalled();
  });

  it("pane_rename names a session the caller opened, through the gate", async () => {
    const { ports, panes } = makePorts();
    const result = await tool(ports, "pane_rename").execute({ sessionId: "sess-a", title: "issue 528" });
    expect(ports.approve).toHaveBeenCalled();
    expect(panes.rename).toHaveBeenCalledWith("sess-a", "issue 528");
    expect(result).toEqual({ ok: true, result: TAB });
  });

  it("pane_rename refuses one of the user's own sessions, before the gate", async () => {
    const { ports, panes } = makePorts();
    expect(await tool(ports, "pane_rename").execute({ sessionId: "sess-b", title: "staging" }))
      .toMatchObject({ refused: true });
    expect(ports.approve).not.toHaveBeenCalled();
    expect(panes.rename).not.toHaveBeenCalled();
  });

  it("tab_rename refuses a tab holding a session the caller did not open, before the gate", async () => {
    const { ports, panes } = makePorts();
    const result = await tool(ports, "tab_rename").execute({ tabId: "tab-1", title: "triage" });
    expect(result).toMatchObject({ refused: true, error: expect.stringMatching(/every pane/) });
    expect(ports.approve).not.toHaveBeenCalled();
    expect(panes.renameTab).not.toHaveBeenCalled();
  });

  it("tab_rename names a tab whose every pane the caller opened", async () => {
    const { ports, panes } = makePorts();
    ports.owned.add("sess-b");
    const result = await tool(ports, "tab_rename").execute({ tabId: "tab-1", title: "triage" });
    expect(panes.renameTab).toHaveBeenCalledWith("tab-1", "triage");
    expect(result).toEqual({ ok: true, result: TAB });
  });

  it("tab_rename leaves an unknown tab id to the API, which refuses it", async () => {
    const { ports, panes } = makePorts();
    panes.renameTab.mockReturnValueOnce({ ok: false, error: "no such split tab" } as never);
    const result = await tool(ports, "tab_rename").execute({ tabId: "tab-404", title: "x" });
    expect(result).toMatchObject({ refused: true, error: "no such split tab" });
  });

  it("the rename verbs tell the model that a title escape written to the terminal changes no label", () => {
    const { ports } = makePorts();
    for (const name of ["pane_rename", "tab_rename"]) {
      expect(tool(ports, name).description).toMatch(/OSC/);
    }
  });

  it("the rename verbs require a title, and tab_rename a tab id", () => {
    const { ports } = makePorts();
    expect(tool(ports, "pane_rename").schema.safeParse({ sessionId: "a" }).success).toBe(false);
    expect(tool(ports, "tab_rename").schema.safeParse({ title: "x" }).success).toBe(false);
    expect(tool(ports, "tab_rename").schema.safeParse({ tabId: "t", title: "" }).success).toBe(true);
  });
});
