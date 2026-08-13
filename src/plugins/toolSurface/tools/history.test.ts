import { describe, expect, it, vi } from "vitest";
import { buildHistoryTools, HISTORY_PERMISSIONS } from "./history";
import type { ToolSurfacePorts } from "../coreTools";

function makePorts() {
  const audit = vi.fn();
  const api = {
    history: {
      search: vi.fn(() => [
        { id: "1", command: "df -h", timestamp: 1, session_id: "s-1", session_name: "web-01", connection_id: "c-1" },
      ]),
    },
  };
  const ports = {
    api,
    approve: async ({ args }: { args: Record<string, unknown> }) => ({ approve: true, scope: "mcp", via: "granted", args }),
    audit,
    owned: new Set<string>(),
  } as unknown as ToolSurfacePorts;
  return { ports, api, audit };
}

const tool = (ports: ToolSurfacePorts) => buildHistoryTools(ports).find((t) => t.name === "history_search")!;

describe("history_search", () => {
  it("declares every permission it reaches", () => {
    expect([...HISTORY_PERMISSIONS]).toEqual(["history:read"]);
  });

  it("reads without an approval prompt or an audit row", async () => {
    const { ports, audit } = makePorts();
    expect(tool(ports).risk).toBe("auto");
    expect(await tool(ports).execute({})).toHaveLength(1);
    expect(audit).not.toHaveBeenCalled();
  });

  it("maps snake_case arguments onto the domain's camelCase filter", async () => {
    const { ports, api } = makePorts();
    await tool(ports).execute({ query: "df", connection_id: "c-1", session_id: "s-1", limit: 10 });
    expect(api.history.search).toHaveBeenCalledWith({
      query: "df", connectionId: "c-1", sessionId: "s-1", limit: 10,
    });
  });
});
