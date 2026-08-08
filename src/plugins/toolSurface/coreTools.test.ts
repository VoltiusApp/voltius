import { describe, test, it, expect, vi, beforeEach } from "vitest";
import { buildCoreTools, type ToolSurfacePorts } from "./coreTools";
import type { Tool } from "./types";

vi.mock("./capture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./capture")>()),
  captureCommand: vi.fn(async () => ({ output: "ok", exitCode: 0, timedOut: false, truncated: false, incomplete: false })),
  sendSerialCommand: vi.fn(async () => ({ output: "device", exitCode: null, timedOut: false, truncated: false, incomplete: true })),
}));
import { captureCommand, sendSerialCommand } from "./capture";

function basePorts(over: Partial<ToolSurfacePorts> = {}): { ports: ToolSurfacePorts; approve: any } {
  let live = [{ id: "sess-1", type: "ssh", status: "connected", connectionId: "c1", connectionName: "srv" }];
  const approve = vi.fn(async () => ({ approve: true as const, scope: "c1", via: "granted" as const }));
  const api = {
    connections: { list: vi.fn(async () => [{ id: "c1", name: "srv", host: "h1" }]) },
    sessions: {
      open: vi.fn(async () => "sess-1"),
      close: vi.fn(async (id: string) => { live = live.filter((s) => s.id !== id); }),
      list: vi.fn(() => live),
    },
    terminal: { readSnapshot: vi.fn(() => "last lines") },
  } as any;
  return { ports: { api, approve, audit: vi.fn(), owned: new Set<string>(), ...over }, approve };
}
const toolsFor = new WeakMap<ToolSurfacePorts, Tool[]>();
const tool = (p: ToolSurfacePorts, name: string) => {
  let ts = toolsFor.get(p);
  if (!ts) {
    ts = buildCoreTools(p);
    toolsFor.set(p, ts);
  }
  return ts.find((t) => t.name === name)!;
};
beforeEach(() => vi.clearAllMocks());

/** Typed ports builder for the tests below, so every `ToolSurfacePorts` member
 *  is actually typechecked — unlike `basePorts()` above, whose `as any` casts
 *  blank that out. */
function makePorts(over: Partial<ToolSurfacePorts> = {}): ToolSurfacePorts {
  let live = [{ id: "sess-1", type: "ssh", status: "connected", connectionId: "conn-A", connectionName: "srv" }];
  const api = {
    connections: { list: vi.fn(async () => [{ id: "conn-A", name: "srv", host: "h1" }]) },
    sessions: {
      open: vi.fn(async () => "sess-1"),
      close: vi.fn(async (id: string) => { live = live.filter((s) => s.id !== id); }),
      list: vi.fn(() => live),
    },
    terminal: { readSnapshot: vi.fn(() => "last lines") },
  } as unknown as ToolSurfacePorts["api"];
  const approve: ToolSurfacePorts["approve"] = vi.fn(async () => ({
    approve: true as const,
    scope: "conn-A",
    via: "granted" as const,
  }));
  return { api, approve, audit: vi.fn(), owned: new Set<string>(), ...over };
}

describe("core tool surface", () => {
  test("exposes 20 tools and no planning tool", () => {
    const ports = makePorts();
    const names = buildCoreTools(ports).map((t) => t.name);
    expect(names).toHaveLength(20);
    expect(names).not.toContain("propose_plan");
  });
});

describe("core tools", () => {
  test("open_session refuses an unknown connection id without raising a card", async () => {
    const c = makePorts();
    const res: any = await buildCoreTools(c).find((t) => t.name === "open_session")!.execute({ connectionId: "h1" });
    expect(String(res.error)).toContain("no connection with id");
    expect(res.connections).toEqual([{ id: "conn-A", name: "srv", host: "h1" }]);
    expect(c.approve).not.toHaveBeenCalled();
    expect(c.api.sessions.open).not.toHaveBeenCalled();
    expect(c.owned.size).toBe(0);
  });

  test("open_session still opens on a real id (non-vacuity partner)", async () => {
    const c = makePorts();
    const res: any = await buildCoreTools(c).find((t) => t.name === "open_session")!.execute({ connectionId: "conn-A" });
    expect(res).toEqual({ sessionId: "sess-1" });
    expect(c.approve).toHaveBeenCalledWith({ tool: "open_session", args: { connectionId: "conn-A" } });
    expect(c.owned.has("sess-1")).toBe(true);
  });

  test("list_connections is auto-risk and returns connections", async () => {
    const { ports: c } = basePorts();
    const t = tool(c, "list_connections");
    expect(t.risk).toBe("auto");
    expect(await t.execute({})).toEqual([{ id: "c1", name: "srv", host: "h1" }]);
  });

  test("read_terminal is auto-risk and reads a snapshot", async () => {
    const { ports: c } = basePorts();
    const t = tool(c, "read_terminal");
    expect(t.risk).toBe("auto");
    expect(await t.execute({ sessionId: "any", maxLines: 50 })).toBe("last lines");
    expect(c.api.terminal.readSnapshot).toHaveBeenCalledWith("any", 50);
  });

  test("open_session prompts, opens, and records the workbench as owned", async () => {
    const { ports: c, approve } = basePorts();
    const t = tool(c, "open_session");
    expect(t.risk).toBe("prompt");
    const res: any = await t.execute({ connectionId: "c1" });
    expect(approve).toHaveBeenCalledWith({ tool: "open_session", args: { connectionId: "c1" } });
    expect(res.sessionId).toBe("sess-1");
    // now run_command should accept that owned session
    const rc: any = await tool(c, "run_command").execute({ sessionId: "sess-1", command: "ls" });
    expect(rc.exitCode).toBe(0);
    expect(captureCommand).toHaveBeenCalled();
  });

  test("run_command rejects a sessionId that is not open (never runs)", async () => {
    const { ports: c } = basePorts();
    const res: any = await tool(c, "run_command").execute({ sessionId: "not-owned", command: "rm -rf /" });
    expect(res.error).toMatch(/no such open session/i);
    expect(captureCommand).not.toHaveBeenCalled();
  });

  test("a rejected approval returns an error result and does not execute", async () => {
    const { ports: c } = basePorts({ approve: vi.fn(async () => ({ approve: false, reason: "no" })) as any });
    const res: any = await tool(c, "open_session").execute({ connectionId: "c1" });
    expect(res.error).toMatch(/rejected/i);
    expect(res.reason).toBe("no");
    expect(c.api.sessions.open).not.toHaveBeenCalled();
  });

  test("a rejected approval on run_command returns an error result and does not execute", async () => {
    const { ports: c, approve } = basePorts();
    await tool(c, "open_session").execute({ connectionId: "c1" }); // own sess-1 first
    approve.mockImplementation(async () => ({ approve: false, reason: "no" }));
    const res: any = await tool(c, "run_command").execute({ sessionId: "sess-1", command: "rm -rf /" });
    expect(res.error).toMatch(/rejected/i);
    expect(res.reason).toBe("no");
    expect(captureCommand).not.toHaveBeenCalled();
  });

  test("a rejected approval on close_session returns an error result and does not execute", async () => {
    const { ports: c, approve } = basePorts();
    await tool(c, "open_session").execute({ connectionId: "c1" }); // own sess-1 first
    approve.mockImplementation(async () => ({ approve: false, reason: "no" }));
    const res: any = await tool(c, "close_session").execute({ sessionId: "sess-1" });
    expect(res.error).toMatch(/rejected/i);
    expect(res.reason).toBe("no");
    expect(c.api.sessions.close).not.toHaveBeenCalled();
  });

  test("approve-with-edited-args runs the edited command", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted", args: { sessionId: "sess-1", command: "ls -a" } }));
    const { ports: c } = basePorts({ approve: approve as any });
    await tool(c, "open_session").execute({ connectionId: "c1" }); // own sess-1 first
    await tool(c, "run_command").execute({ sessionId: "sess-1", command: "ls" });
    expect(captureCommand).toHaveBeenLastCalledWith(expect.anything(), "sess-1", "ls -a", expect.anything());
  });

  test("approve-with-edited-args swapping in a sessionId that is not open is rejected post-approval (never runs)", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted", args: { sessionId: "not-owned", command: "ls" } }));
    const { ports: c } = basePorts({ approve: approve as any });
    await tool(c, "open_session").execute({ connectionId: "c1" }); // own sess-1, not "not-owned"
    const res: any = await tool(c, "run_command").execute({ sessionId: "sess-1", command: "ls" });
    expect(res.error).toMatch(/no such open session/i);
    expect(captureCommand).not.toHaveBeenCalled();
  });

  test("a session owned via one buildCoreTools() call stays owned by a second, separately built tool set sharing ports.owned (conversation lifetime across turns)", async () => {
    const { ports: c } = basePorts();
    const turn1 = buildCoreTools(c);
    const openSession = turn1.find((t) => t.name === "open_session")!;
    const opened: any = await openSession.execute({ connectionId: "c1" });
    expect(opened.sessionId).toBe("sess-1");

    const turn2 = buildCoreTools(c);
    const runCommand = turn2.find((t) => t.name === "run_command")!;
    const res: any = await runCommand.execute({ sessionId: "sess-1", command: "ls" });
    expect(res.exitCode).toBe(0);
    expect(captureCommand).toHaveBeenCalled();
  });

  test("close_session prompts, closes, and un-owns", async () => {
    const { ports: c } = basePorts();
    await tool(c, "open_session").execute({ connectionId: "c1" });
    await tool(c, "close_session").execute({ sessionId: "sess-1" });
    expect(c.api.sessions.close).toHaveBeenCalledWith("sess-1");
    expect(c.owned.has("sess-1")).toBe(false);
    // The closed session is gone from the host, so a later run is refused for
    // that reason — un-owning alone no longer refuses one, since run_command
    // may act in sessions the user opened.
    const res: any = await tool(c, "run_command").execute({ sessionId: "sess-1", command: "ls" });
    expect(res.error).toMatch(/no such open session/i);
  });

  test("run_command runs in a live session the agent does not own (the user's own terminal)", async () => {
    const { ports: c, approve } = basePorts();
    expect(c.owned.has("sess-1")).toBe(false);
    const res: any = await tool(c, "run_command").execute({ sessionId: "sess-1", command: "ls" });
    expect(approve).toHaveBeenCalled();
    expect(res.exitCode).toBe(0);
    expect(captureCommand).toHaveBeenCalled();
  });

  test("close_session hard-rejects a non-owned session (never closes, never prompts)", async () => {
    const { ports: c, approve } = basePorts();
    const res: any = await tool(c, "close_session").execute({ sessionId: "not-owned" });
    expect(res.error).toMatch(/not owned|open_session/i);
    expect(c.api.sessions.close).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  test("approve-with-edited-args swapping in a non-owned sessionId is rejected post-approval on close_session (never closes)", async () => {
    const approve = vi.fn(async () => ({ approve: true, scope: "c1", via: "prompted", args: { sessionId: "not-owned" } }));
    const { ports: c } = basePorts({ approve: approve as any });
    await tool(c, "open_session").execute({ connectionId: "c1" }); // own sess-1, not "not-owned"
    const res: any = await tool(c, "close_session").execute({ sessionId: "sess-1" });
    expect(res.error).toMatch(/not owned|open_session/i);
    expect(c.api.sessions.close).not.toHaveBeenCalled();
  });
});

describe("session audit carries the approval classifier", () => {
  it("records how open_session was authorized", async () => {
    const ports = makePorts({
      approve: vi.fn(async () => ({ approve: true as const, scope: "conn-A", via: "plan" as const })),
    });
    await buildCoreTools(ports).find((x) => x.name === "open_session")!.execute({ connectionId: "conn-A" });
    expect(ports.audit).toHaveBeenCalledWith(
      "conn-A", "agent.session_opened", { tool: "open_session", approval: "plan" },
    );
  });

  it("records a plan-authorized command_run as approval:plan", async () => {
    const ports = makePorts({
      approve: vi.fn(async () => ({ approve: true as const, scope: "conn-A", via: "plan" as const })),
      owned: new Set(["sess-1"]),
    });
    await buildCoreTools(ports).find((x) => x.name === "run_command")!
      .execute({ sessionId: "sess-1", command: "df -h" });
    expect(ports.audit).toHaveBeenCalledWith(
      "conn-A",
      "agent.command_run",
      { tool: "run_command", approval: "plan", sessionType: "ssh", agentOwned: true },
      { command: "df -h" },
    );
  });
});

describe("ownership is checked upstream of any authorization", () => {
  // 3e widens reachability: a plan can pre-authorize run_command, so the
  // guarantee that NO approval mechanism can reach past ports.owned needs its
  // own pin rather than resting on the approval path being the only caller.
  it("refuses a session that is not open without ever consulting the approval port", async () => {
    const approve = vi.fn(async () => ({ approve: true as const, scope: "conn-A", via: "plan" as const }));
    const ports = makePorts({ approve, owned: new Set<string>() });
    await expect(
      buildCoreTools(ports).find((x) => x.name === "run_command")!
        .execute({ sessionId: "sess-ghost", command: "df -h" }),
    ).resolves.toMatchObject({ error: expect.stringContaining("no such open session") });
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses close_session on an unowned session the same way", async () => {
    const approve = vi.fn(async () => ({ approve: true as const, scope: "conn-A", via: "plan" as const }));
    const ports = makePorts({ approve, owned: new Set<string>() });
    await expect(
      buildCoreTools(ports).find((x) => x.name === "close_session")!.execute({ sessionId: "sess-ghost" }),
    ).resolves.toMatchObject({ error: expect.stringContaining("not owned") });
    expect(approve).not.toHaveBeenCalled();
  });
});

describe("session-type routing", () => {
  function serialPorts(): ToolSurfacePorts {
    const live = [
      { id: "ser-1", type: "serial", status: "connected", connectionId: "conn-S", connectionName: "dev" },
      { id: "ssh-1", type: "ssh", status: "connected", connectionId: "conn-A", connectionName: "srv" },
      { id: "loc-1", type: "local", status: "connected", connectionId: "local", connectionName: "bash" },
    ];
    return {
      api: {
        connections: { list: vi.fn(async () => [{ id: "conn-A", name: "srv", host: "h1" }]) },
        sessions: { open: vi.fn(), close: vi.fn(), list: vi.fn(() => live) },
        terminal: { readSnapshot: vi.fn(() => "") },
      } as unknown as ToolSurfacePorts["api"],
      approve: vi.fn(async () => ({ approve: true as const, scope: "conn-S", via: "prompted" as const })),
      audit: vi.fn(),
      owned: new Set<string>(),
    };
  }

  test("list_sessions exposes the user's local and serial sessions, not just agent-owned ones", async () => {
    const c = serialPorts();
    const res = (await buildCoreTools(c).find((t) => t.name === "list_sessions")!.execute({})) as Array<{
      id: string; type: string; agentOwned: boolean;
    }>;
    expect(res.map((s) => s.type).sort()).toEqual(["local", "serial", "ssh"]);
    expect(res.every((s) => s.agentOwned === false)).toBe(true);
  });

  test("run_command sends verbatim on a serial session — no shell markers reach the device", async () => {
    const c = serialPorts();
    await buildCoreTools(c).find((t) => t.name === "run_command")!.execute({ sessionId: "ser-1", command: "AT" });
    expect(sendSerialCommand).toHaveBeenCalledWith(expect.anything(), "ser-1", "AT", expect.anything());
    expect(captureCommand).not.toHaveBeenCalled();
  });

  test("run_command uses marker capture on a local shell", async () => {
    const c = serialPorts();
    await buildCoreTools(c).find((t) => t.name === "run_command")!.execute({ sessionId: "loc-1", command: "ls" });
    expect(captureCommand).toHaveBeenCalledWith(expect.anything(), "loc-1", "ls", expect.anything());
    expect(sendSerialCommand).not.toHaveBeenCalled();
  });
});

describe("file tools", () => {
  function filePorts(over: Partial<ToolSurfacePorts> = {}): ToolSurfacePorts {
    const sftp = {
      list: vi.fn(async () => [{ name: "a.txt", path: "/srv/a.txt", size: 3, isDir: false, isSymlink: false, modified: 1 }]),
      stat: vi.fn(async () => ({ name: "a.txt", path: "/srv/a.txt", size: 3, isDir: false, isSymlink: false, modified: 1 })),
      readText: vi.fn(async () => "hello"),
      writeText: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
      rename: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      transfer: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
    };
    return {
      api: {
        sftp,
        connections: { list: vi.fn(async () => [{ id: "conn-A", name: "srv", host: "h1" }]) },
        sessions: { open: vi.fn(), close: vi.fn(), list: vi.fn(() => []) },
        terminal: { readSnapshot: vi.fn(() => "") },
      } as unknown as ToolSurfacePorts["api"],
      approve: vi.fn(async () => ({ approve: true as const, scope: "conn-A", via: "prompted" as const })),
      audit: vi.fn(),
      owned: new Set<string>(),
      ...over,
    };
  }
  const t = (c: ToolSurfacePorts, n: string) => buildCoreTools(c).find((x) => x.name === n)!;
  const sftpOf = (c: ToolSurfacePorts) => (c.api as unknown as { sftp: Record<string, ReturnType<typeof vi.fn>> }).sftp;

  test("read tools are auto-risk and never consult the approval port", async () => {
    const c = filePorts();
    for (const name of ["list_files", "stat_file", "read_file"]) {
      expect(t(c, name).risk).toBe("auto");
    }
    await t(c, "list_files").execute({ target: "conn-A", path: "/srv" });
    expect(c.approve).not.toHaveBeenCalled();
  });

  test.each(["make_dir", "write_file", "rename_path", "delete_path", "transfer_file"])(
    "%s is prompt-risk", (name) => {
      expect(t(filePorts(), name).risk).toBe("prompt");
    },
  );

  test("delete_path runs only after approval, and records the operation", async () => {
    const c = filePorts();
    await t(c, "delete_path").execute({ target: "conn-A", path: "/srv/a.txt" });
    expect(c.approve).toHaveBeenCalledWith({ tool: "delete_path", args: { target: "conn-A", path: "/srv/a.txt" } });
    expect(sftpOf(c).delete).toHaveBeenCalledWith("conn-A", "/srv/a.txt");
    expect(c.audit).toHaveBeenCalledWith(
      "conn-A", "agent.file_deleted",
      { tool: "delete_path", approval: "prompted" },
      expect.objectContaining({ args: expect.stringContaining("/srv/a.txt") }),
    );
  });

  test("a rejected delete never reaches the filesystem", async () => {
    const c = filePorts({ approve: vi.fn(async () => ({ approve: false as const, reason: "no" })) });
    const res = await t(c, "delete_path").execute({ target: "conn-A", path: "/srv/a.txt" });
    expect(res).toMatchObject({ error: "rejected by user" });
    expect(sftpOf(c).delete).not.toHaveBeenCalled();
    expect(c.audit).not.toHaveBeenCalled();
  });

  test("transfer_file passes both endpoints straight through", async () => {
    const c = filePorts();
    await t(c, "transfer_file").execute({
      fromTarget: "conn-A", fromPath: "/srv/a.txt", toTarget: "local", toPath: "/home/u/a.txt",
    });
    expect(sftpOf(c).transfer).toHaveBeenCalledWith(
      { target: "conn-A", path: "/srv/a.txt" },
      { target: "local", path: "/home/u/a.txt" },
    );
  });

  test("a failing operation returns an error result rather than throwing out of the tool", async () => {
    const c = filePorts();
    sftpOf(c).mkdir.mockRejectedValueOnce(new Error("permission denied"));
    await expect(t(c, "make_dir").execute({ target: "conn-A", path: "/srv/x" }))
      .resolves.toMatchObject({ error: "permission denied" });
  });
});

describe("the text port", () => {
  it("uses a consumer's description when one is supplied", () => {
    const tools = buildCoreTools(makePorts({ text: { descriptions: { delete_path: "consumer copy" } } }));
    expect(tools.find((t) => t.name === "delete_path")?.description).toBe("consumer copy");
  });

  it("falls back to the built-in description for tools the consumer does not override", () => {
    const tools = buildCoreTools(makePorts({ text: { descriptions: { delete_path: "consumer copy" } } }));
    expect(tools.find((t) => t.name === "make_dir")?.description).toContain("Prompts.");
  });

  it("leaves every description untouched when no text port is supplied", () => {
    const withPort = buildCoreTools(makePorts({ text: {} })).map((t) => t.description);
    const without = buildCoreTools(makePorts()).map((t) => t.description);
    expect(withPort).toEqual(without);
  });

  it("uses a consumer's not-owned error in close_session", async () => {
    const tools = buildCoreTools(makePorts({ text: { notOwnedError: "not yours" } }));
    const out = await tools.find((t) => t.name === "close_session")!.execute({ sessionId: "nope" });
    expect(out).toEqual({ error: "not yours" });
  });

  it("uses a consumer's not-owned error in close_session's post-approval check", async () => {
    const approve = vi.fn(async () => ({ approve: true as const, scope: "conn-A", via: "prompted" as const, args: { sessionId: "not-owned" } }));
    const ports = makePorts({ approve, text: { notOwnedError: "not yours" } });
    const tools = buildCoreTools(ports);
    await tools.find((t) => t.name === "open_session")!.execute({ connectionId: "conn-A" }); // owns sess-1, not "not-owned"
    const out = await tools.find((t) => t.name === "close_session")!.execute({ sessionId: "sess-1" });
    expect(out).toEqual({ error: "not yours" });
  });
});
