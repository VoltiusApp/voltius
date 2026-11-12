import { describe, expect, it, vi } from "vitest";
import { buildSessionTools } from "./sessions";
import type { ToolSurfacePorts } from "../coreTools";

function makePorts(locked: boolean) {
  const close = vi.fn(async () => {});
  const approve = vi.fn(async ({ args }: { args: Record<string, unknown> }) => ({ approve: true, scope: "mcp", via: "granted", args }));
  const ports = {
    api: { sessions: { list: () => [{ id: "w1", connectionId: "c", connectionName: "c", status: "connected", type: "ssh", locked }], close } },
    approve,
    audit: vi.fn(),
    owned: new Set<string>(["w1"]),
  } as unknown as ToolSurfacePorts;
  return { ports, close, approve };
}

const closeTool = (ports: ToolSurfacePorts) => buildSessionTools(ports).find((t) => t.name === "close_session")!;

describe("close_session on a locked tab", () => {
  it("refuses with tab_locked without asking for approval or closing", async () => {
    const { ports, close, approve } = makePorts(true);
    const result = await closeTool(ports).execute({ sessionId: "w1" });
    expect(result).toMatchObject({ refused: true });
    expect(String((result as { error: string }).error)).toMatch(/^tab_locked/);
    expect(approve).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("still closes an unlocked tab", async () => {
    const { ports, close } = makePorts(false);
    await closeTool(ports).execute({ sessionId: "w1" });
    expect(close).toHaveBeenCalledWith("w1");
  });
});
