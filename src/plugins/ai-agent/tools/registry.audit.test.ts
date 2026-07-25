import { describe, it, expect, vi, beforeEach } from "vitest";

const auditAgentAction = vi.fn();
vi.mock("../state/auditSeam", () => ({ auditAgentAction }));
vi.mock("./capture", () => ({ captureCommand: vi.fn(async () => ({ output: "ok", exitCode: 0 })) }));

const { buildTools } = await import("./registry");

function tools(approve: ReturnType<typeof vi.fn>) {
  const api = {
    sessions: { open: vi.fn(async () => "s1"), close: vi.fn(async () => {}) },
    connections: { list: vi.fn(async () => []) },
    terminal: { readSnapshot: vi.fn(async () => "") },
  };
  const owned = new Set<string>();
  return { list: buildTools({ api, approve, owned } as never), owned, api };
}

const byName = (list: ReturnType<typeof buildTools>, n: string) => list.find((t) => t.name === n)!;

beforeEach(() => auditAgentAction.mockClear());

describe("execution auditing", () => {
  it("records an opened session against its connection", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted" }));
    const { list } = tools(approve);
    await byName(list, "open_session").execute({ connectionId: "c1" });
    expect(auditAgentAction).toHaveBeenCalledWith("c1", "agent.session_opened", { tool: "open_session" });
  });

  it("records a command with the approval reason on the wire and the text local-only", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "granted" }));
    const { list, owned } = tools(approve);
    owned.add("s1");
    await byName(list, "run_command").execute({ sessionId: "s1", command: "uptime" });
    expect(auditAgentAction).toHaveBeenCalledWith(
      "c1", "agent.command_run",
      { tool: "run_command", approval: "granted" },
      { command: "uptime" },
    );
  });

  it("carries via=auto_mode through to the approval classifier", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "auto_mode" }));
    const { list, owned } = tools(approve);
    owned.add("s1");
    await byName(list, "run_command").execute({ sessionId: "s1", command: "uptime" });
    expect(auditAgentAction.mock.calls[0][2]).toEqual({ tool: "run_command", approval: "auto_mode" });
  });

  it("carries via=prompted through to the approval classifier", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted" }));
    const { list, owned } = tools(approve);
    owned.add("s1");
    await byName(list, "run_command").execute({ sessionId: "s1", command: "uptime" });
    expect(auditAgentAction.mock.calls[0][2]).toEqual({ tool: "run_command", approval: "prompted" });
  });

  it("records a closed session", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted" }));
    const { list, owned } = tools(approve);
    owned.add("s1");
    await byName(list, "close_session").execute({ sessionId: "s1" });
    expect(auditAgentAction).toHaveBeenCalledWith("c1", "agent.session_closed", { tool: "close_session" });
  });

  it("records NOTHING when the gate rejects — the store logs the denial", async () => {
    const approve = vi.fn(async () => ({ approve: false, reason: "no" }));
    const { list, owned } = tools(approve);
    owned.add("s1");
    await byName(list, "run_command").execute({ sessionId: "s1", command: "uptime" });
    expect(auditAgentAction).not.toHaveBeenCalled();
  });

  it("records NOTHING for an unowned session — it never reaches the gate", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted" }));
    const { list } = tools(approve);
    await byName(list, "run_command").execute({ sessionId: "not-ours", command: "uptime" });
    expect(auditAgentAction).not.toHaveBeenCalled();
  });

  it("records NOTHING for read-only tools", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted" }));
    const { list } = tools(approve);
    await byName(list, "list_connections").execute({});
    await byName(list, "read_terminal").execute({ sessionId: "s1" });
    expect(auditAgentAction).not.toHaveBeenCalled();
  });
});
