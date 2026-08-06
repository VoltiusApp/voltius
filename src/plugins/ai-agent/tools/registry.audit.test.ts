import { describe, it, expect, vi, beforeEach } from "vitest";

const auditAgentAction = vi.fn();
vi.mock("../state/auditSeam", () => ({ auditAgentAction }));
vi.mock("./capture", () => ({
  captureCommand: vi.fn(async () => ({ output: "ok", exitCode: 0 })),
  sendSerialCommand: vi.fn(async () => ({ output: "device", exitCode: null })),
}));

const { buildTools } = await import("./registry");

function tools(approve: ReturnType<typeof vi.fn>) {
  const api = {
    sessions: {
      open: vi.fn(async () => "s1"),
      close: vi.fn(async () => {}),
      list: vi.fn(() => [{ id: "s1", type: "ssh", status: "connected", connectionId: "c1", connectionName: "srv" }]),
    },
    connections: { list: vi.fn(async () => [{ id: "c1", name: "srv", host: "h1" }]) },
    terminal: { readSnapshot: vi.fn(async () => "") },
    sftp: {
      list: vi.fn(async () => []), stat: vi.fn(async () => null),
      readText: vi.fn(async () => ""), writeText: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}), rename: vi.fn(async () => {}),
      delete: vi.fn(async () => {}), transfer: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
    },
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
    expect(auditAgentAction).toHaveBeenCalledWith("c1", "agent.session_opened", { tool: "open_session", approval: "prompted" });
  });

  it("records a command with the approval reason on the wire and the text local-only", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "granted" }));
    const { list, owned } = tools(approve);
    owned.add("s1");
    await byName(list, "run_command").execute({ sessionId: "s1", command: "uptime" });
    expect(auditAgentAction).toHaveBeenCalledWith(
      "c1", "agent.command_run",
      { tool: "run_command", approval: "granted", sessionType: "ssh", agentOwned: true },
      { command: "uptime" },
    );
  });

  it("carries via=auto_mode through to the approval classifier", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "auto_mode" }));
    const { list, owned } = tools(approve);
    owned.add("s1");
    await byName(list, "run_command").execute({ sessionId: "s1", command: "uptime" });
    expect(auditAgentAction.mock.calls[0][2]).toEqual({ tool: "run_command", approval: "auto_mode", sessionType: "ssh", agentOwned: true });
  });

  it("carries via=prompted through to the approval classifier", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted" }));
    const { list, owned } = tools(approve);
    owned.add("s1");
    await byName(list, "run_command").execute({ sessionId: "s1", command: "uptime" });
    expect(auditAgentAction.mock.calls[0][2]).toEqual({ tool: "run_command", approval: "prompted", sessionType: "ssh", agentOwned: true });
  });

  it("flags a command run in the user's own session as not agent-owned", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted" }));
    const { list } = tools(approve); // s1 is live but never added to `owned`
    await byName(list, "run_command").execute({ sessionId: "s1", command: "uptime" });
    expect(auditAgentAction.mock.calls[0][2]).toMatchObject({ agentOwned: false, sessionType: "ssh" });
  });

  it("records a closed session", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted" }));
    const { list, owned } = tools(approve);
    owned.add("s1");
    await byName(list, "close_session").execute({ sessionId: "s1" });
    expect(auditAgentAction).toHaveBeenCalledWith("c1", "agent.session_closed", { tool: "close_session", approval: "prompted" });
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

  // Each of these must also be on the server's CLIENT_WHITELIST; an action it
  // does not know is 400ed and swallowed, leaving the team trail empty.
  it.each([
    ["make_dir", { target: "c1", path: "/srv/d" }, "agent.file_created"],
    ["write_file", { target: "c1", path: "/srv/a", content: "x" }, "agent.file_written"],
    ["rename_path", { target: "c1", from: "/srv/a", to: "/srv/b" }, "agent.file_renamed"],
    ["delete_path", { target: "c1", path: "/srv/a" }, "agent.file_deleted"],
    [
      "transfer_file",
      { fromTarget: "c1", fromPath: "/srv/a", toTarget: "local", toPath: "/tmp/a" },
      "agent.file_transferred",
    ],
  ])("records %s as %s", async (tool, args, action) => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted" }));
    const { list } = tools(approve);
    await byName(list, tool).execute(args);
    expect(auditAgentAction.mock.calls[0][1]).toBe(action);
    expect(auditAgentAction.mock.calls[0][2]).toMatchObject({ tool });
  });

  it("records NOTHING for read-only tools", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted" }));
    const { list } = tools(approve);
    await byName(list, "list_connections").execute({});
    await byName(list, "read_terminal").execute({ sessionId: "s1" });
    expect(auditAgentAction).not.toHaveBeenCalled();
  });
});
