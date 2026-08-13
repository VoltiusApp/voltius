import { describe, expect, it, vi } from "vitest";
import { buildSharingTools, SHARING_PERMISSIONS } from "./sharing";
import type { ToolSurfacePorts } from "../coreTools";

const SHARED = {
  multiplayerSessionId: "m1",
  localSessionId: "s1",
  connectionName: "prod",
  isHost: true,
  participants: [{ userId: "u2", displayName: "Bo" }],
  controlHolder: "u1",
  controlRequester: "u2",
};

function makePorts(
  overrides: Record<string, unknown> = {},
  opts: { approve?: boolean; owned?: ToolSurfacePorts["owned"] } = {},
) {
  const audit = vi.fn();
  const sharing = {
    list: vi.fn(async () => [SHARED]),
    shareRefusal: vi.fn(() => null as string | null),
    share: vi.fn(async () => ({ ok: true as const, result: { multiplayerSessionId: "m1" } })),
    unshare: vi.fn(async () => ({ ok: true as const, result: null })),
    handoffControl: vi.fn(async () => ({ ok: true as const, result: null })),
    ...overrides,
  };
  const approve = vi.fn(async ({ args }: { args: Record<string, unknown> }) =>
    opts.approve === false
      ? { approve: false as const, reason: "no" }
      : { approve: true as const, args, scope: "share", via: "granted" as const });
  const ports = {
    api: { sharing } as unknown as ToolSurfacePorts["api"],
    approve,
    audit,
    owned: opts.owned ?? new Set(["s1"]),
  } as unknown as ToolSurfacePorts;
  return { ports, sharing, audit, approve };
}

const tool = (ports: ToolSurfacePorts, name: string) => {
  const found = buildSharingTools(ports).find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

const NOT_OWNED = {
  refused: true,
  error: "that session was not opened by you; sharing acts only on sessions you opened",
};

describe("sharing verbs", () => {
  it("declares exactly the four sharing verbs and their permissions", () => {
    const { ports } = makePorts();
    expect(buildSharingTools(ports).map((t) => t.name)).toEqual([
      "list_shared_sessions", "share_session", "unshare_session", "handoff_control",
    ]);
    expect([...SHARING_PERMISSIONS]).toEqual(["sharing:read", "sharing:write"]);
  });

  it("marks the read auto and the three writes prompt", () => {
    const { ports } = makePorts();
    expect(Object.fromEntries(buildSharingTools(ports).map((t) => [t.name, t.risk]))).toEqual({
      list_shared_sessions: "auto",
      share_session: "prompt",
      unshare_session: "prompt",
      handoff_control: "prompt",
    });
  });

  it("list_shared_sessions returns the rows, raising no card and writing no audit row", async () => {
    const { ports, audit, approve, sharing } = makePorts({}, { owned: new Set() as unknown as ToolSurfacePorts["owned"] });
    expect(await tool(ports, "list_shared_sessions").execute({})).toEqual([{ ...SHARED, agentOwned: false }]);
    expect(sharing.list).toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("list_shared_sessions marks the rows the agent may act on, by the pure ownership read", async () => {
    const acquire = vi.fn(() => true);
    const owned = {
      has: (id: string) => id === "s1", add: () => {}, delete: () => false, acquire,
    } as unknown as ToolSurfacePorts["owned"];
    const { ports } = makePorts({
      list: vi.fn(async () => [
        SHARED,
        { ...SHARED, multiplayerSessionId: "m2", localSessionId: "s2" },
        { ...SHARED, multiplayerSessionId: "m3", localSessionId: null },
      ]),
    }, { owned });
    const rows = await tool(ports, "list_shared_sessions").execute({}) as { agentOwned: boolean }[];
    expect(rows.map((r) => r.agentOwned)).toEqual([true, false, false]);
    // A read must never adopt: acquire is mayAct's side effect and belongs to
    // the write path only.
    expect(acquire).not.toHaveBeenCalled();
  });

  it("share_session refuses a broadcasting tab before the card is raised and before the audit row", async () => {
    const { ports, sharing, audit, approve } = makePorts({
      shareRefusal: vi.fn(() => "that tab has broadcast typing enabled" as string | null),
    });
    expect(await tool(ports, "share_session").execute({ sessionId: "s1", vaultIds: ["t1"] }))
      .toEqual({ refused: true, error: "that tab has broadcast typing enabled" });
    expect(sharing.shareRefusal).toHaveBeenCalledWith("s1");
    expect(approve).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(sharing.share).not.toHaveBeenCalled();
  });

  it("share_session audits before dispatch and wraps the domain result", async () => {
    const { ports, sharing, audit } = makePorts();
    const res = await tool(ports, "share_session")
      .execute({ sessionId: "s1", vaultIds: ["t1"], allowedRoles: ["r1"] });
    expect(sharing.share).toHaveBeenCalledWith({
      sessionId: "s1", vaultIds: ["t1"], allowedRoles: ["r1"],
    });
    // vaultIds is on the row deliberately: without it the trail says a session
    // was shared but not with whom, which is the security content of the verb.
    // allowedRoles stays off — it names no counterparty.
    expect(audit).toHaveBeenCalledWith(
      "share",
      "agent.session_shared",
      { tool: "share_session", approval: "granted", sessionId: "s1", vaultIds: ["t1"] },
      undefined,
    );
    expect(audit.mock.invocationCallOrder[0]).toBeLessThan(sharing.share.mock.invocationCallOrder[0]);
    expect(res).toEqual({ ok: true, result: { multiplayerSessionId: "m1" } });
  });

  it("unshare_session and handoff_control audit their own action and return a null result", async () => {
    const { ports, sharing, audit } = makePorts();
    expect(await tool(ports, "unshare_session").execute({ sessionId: "s1" }))
      .toEqual({ ok: true, result: null });
    expect(sharing.unshare).toHaveBeenCalledWith("s1");
    expect(audit.mock.calls[0][1]).toBe("agent.session_unshared");

    expect(await tool(ports, "handoff_control").execute({ sessionId: "s1", userId: "u2" }))
      .toEqual({ ok: true, result: null });
    expect(sharing.handoffControl).toHaveBeenCalledWith("s1", "u2");
    expect(audit.mock.calls[1][1]).toBe("agent.control_granted");
    expect(audit.mock.calls[0][2]).toEqual({
      tool: "unshare_session", approval: "granted", sessionId: "s1",
    });
    // The recipient of control is on the row: a trail that cannot say who was
    // handed the shell records nothing worth reviewing.
    expect(audit.mock.calls[1][2]).toEqual({
      tool: "handoff_control", approval: "granted", sessionId: "s1", userId: "u2",
    });
  });

  it("refuses a session the agent did not open, without raising a card or dispatching", async () => {
    const none = new Set() as unknown as ToolSurfacePorts["owned"];
    for (const [name, args] of [
      ["share_session", { sessionId: "s9", vaultIds: ["t1"] }],
      ["unshare_session", { sessionId: "s9" }],
      ["handoff_control", { sessionId: "s9", userId: "u2" }],
    ] as const) {
      const { ports, sharing, audit, approve } = makePorts({}, { owned: none });
      expect(await tool(ports, name).execute(args)).toEqual(NOT_OWNED);
      expect(approve).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
      expect(sharing.share).not.toHaveBeenCalled();
      expect(sharing.unshare).not.toHaveBeenCalled();
      expect(sharing.handoffControl).not.toHaveBeenCalled();
    }
  });

  /** Owned on the pre-gate check, lost by the post-gate one: what a session
   *  closed or handed away while the approval card sat pending looks like. */
  const lostAfterGate = () => {
    let first = true;
    return {
      has: () => { const v = first; first = false; return v; },
      add: () => {},
      delete: () => false,
    } as unknown as ToolSurfacePorts["owned"];
  };

  it("share_session re-checks ownership after the approval and does not share", async () => {
    const { ports, sharing, approve } = makePorts({}, { owned: lostAfterGate() });
    expect(await tool(ports, "share_session").execute({ sessionId: "s1", vaultIds: ["t1"] }))
      .toEqual(NOT_OWNED);
    expect(approve).toHaveBeenCalled();
    expect(sharing.share).not.toHaveBeenCalled();
  });

  it("unshare_session re-checks ownership after the approval and does not unshare", async () => {
    const { ports, sharing, approve } = makePorts({}, { owned: lostAfterGate() });
    expect(await tool(ports, "unshare_session").execute({ sessionId: "s1" })).toEqual(NOT_OWNED);
    expect(approve).toHaveBeenCalled();
    expect(sharing.unshare).not.toHaveBeenCalled();
  });

  it("handoff_control re-checks ownership after the approval and does not hand off", async () => {
    const { ports, sharing, approve } = makePorts({}, { owned: lostAfterGate() });
    expect(await tool(ports, "handoff_control").execute({ sessionId: "s1", userId: "u2" }))
      .toEqual(NOT_OWNED);
    expect(approve).toHaveBeenCalled();
    expect(sharing.handoffControl).not.toHaveBeenCalled();
  });

  it("a rejected approval never reaches the API and writes no audit row", async () => {
    const { ports, sharing, audit } = makePorts({}, { approve: false });
    expect(await tool(ports, "unshare_session").execute({ sessionId: "s1" }))
      .toEqual({ refused: true, error: "rejected by user", reason: "no" });
    expect(sharing.unshare).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("returns a domain refusal as a refusal, never wrapped in a success", async () => {
    const { ports } = makePorts({
      handoffControl: vi.fn(async () => ({ ok: false as const, error: "u2 has not requested control" })),
    });
    expect(await tool(ports, "handoff_control").execute({ sessionId: "s1", userId: "u2" }))
      .toEqual({ refused: true, error: "u2 has not requested control" });
  });

  it("returns a thrown API failure as a refusal", async () => {
    const { ports } = makePorts({ share: vi.fn(async () => { throw new Error("offline"); }) });
    expect(await tool(ports, "share_session").execute({ sessionId: "s1", vaultIds: ["t1"] }))
      .toEqual({ refused: true, error: "offline" });
  });

  it("uses the consumer's own not-owned wording when it supplies one", async () => {
    const { ports } = makePorts({}, { owned: new Set() as unknown as ToolSurfacePorts["owned"] });
    const withText = { ...ports, text: { notOwnedError: "not yours" } } as ToolSurfacePorts;
    expect(await tool(withText, "unshare_session").execute({ sessionId: "s9" }))
      .toEqual({ refused: true, error: "not yours" });
  });

  it("share_session requires at least one vault id at the schema", () => {
    const { ports } = makePorts();
    const { schema } = tool(ports, "share_session");
    expect(schema.safeParse({ sessionId: "s1", vaultIds: [] }).success).toBe(false);
    expect(schema.safeParse({ sessionId: "s1", vaultIds: ["t1"] }).success).toBe(true);
  });
});
