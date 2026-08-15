import { describe, expect, it, vi } from "vitest";
import { buildTeamTools, TEAM_PERMISSIONS } from "./team";
import type { ToolSurfacePorts } from "../coreTools";

const TEAM = { id: "t1", name: "Ops", ownerTier: "pro", myRoles: ["owner"], myRoleIds: ["r0"], vaultStatus: "ready" };
const MEMBER = {
  userId: "u2", displayName: "brisk-otter-8823", roles: ["member"], roleIds: ["r1"], isOnline: true, state: "member" as const,
};
const KEY_STATUS = {
  teamId: "t1",
  vaultStatus: "ready",
  iHoldKey: true,
  members: [{ userId: "u2", displayName: "brisk-otter-8823", hasPublicKey: true, hasWrappedKey: false }],
};

function makePorts(overrides: Record<string, unknown> = {}, approve = true) {
  const audit = vi.fn();
  const team = {
    list: vi.fn(async () => [TEAM]),
    members: vi.fn(async () => [MEMBER]),
    keyStatus: vi.fn(async () => [KEY_STATUS]),
    invite: vi.fn(async () => ({ ok: true as const, result: { status: "invited", key: null } })),
    removeMember: vi.fn(async () => ({ ok: true as const, result: null })),
    setMemberRole: vi.fn(async () => ({ ok: true as const, result: null })),
    ...overrides,
  };
  const approveFn = vi.fn(async ({ args }: { args: Record<string, unknown> }) =>
    approve
      ? { approve: true as const, args, scope: "team", via: "granted" as const }
      : { approve: false as const, reason: "no" });
  const ports = {
    api: { team } as unknown as ToolSurfacePorts["api"],
    approve: approveFn,
    audit,
    owned: new Set<string>(),
  } as unknown as ToolSurfacePorts;
  return { ports, team, audit, approve: approveFn };
}

const tool = (ports: ToolSurfacePorts, name: string) => {
  const found = buildTeamTools(ports).find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

describe("team verbs", () => {
  it("declares exactly the six team verbs and their permissions", () => {
    const { ports } = makePorts();
    expect(buildTeamTools(ports).map((t) => t.name)).toEqual([
      "team_list", "member_list", "vault_key_status", "member_invite", "member_remove", "member_set_role",
    ]);
    expect([...TEAM_PERMISSIONS]).toEqual(["team:read", "team:write"]);
  });

  it("marks the reads auto and the writes prompt", () => {
    const { ports } = makePorts();
    const risks = Object.fromEntries(buildTeamTools(ports).map((t) => [t.name, t.risk]));
    expect(risks).toEqual({
      team_list: "auto",
      member_list: "auto",
      vault_key_status: "auto",
      member_invite: "prompt",
      member_remove: "prompt",
      member_set_role: "prompt",
    });
  });

  it("returns each read's rows unwrapped, raising no card and writing no audit row", async () => {
    const { ports, audit, approve, team } = makePorts();
    expect(await tool(ports, "team_list").execute({})).toEqual([TEAM]);
    expect(await tool(ports, "member_list").execute({ teamId: "t1" })).toEqual([MEMBER]);
    expect(await tool(ports, "vault_key_status").execute({})).toEqual([KEY_STATUS]);
    expect(team.members).toHaveBeenCalledWith("t1");
    expect(team.keyStatus).toHaveBeenCalledWith(undefined);
    expect(approve).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("scopes vault_key_status to one team when asked", async () => {
    const { ports, team } = makePorts();
    await tool(ports, "vault_key_status").execute({ teamId: "t1" });
    expect(team.keyStatus).toHaveBeenCalledWith("t1");
  });

  it("member_invite audits before dispatch and returns the domain result wrapped", async () => {
    const { ports, team, audit } = makePorts();
    const res = await tool(ports, "member_invite").execute({ teamId: "t1", email: "b@example.com", role: "member" });
    expect(team.invite).toHaveBeenCalledWith({
      teamId: "t1", email: "b@example.com", userId: undefined, role: "member",
    });
    expect(audit).toHaveBeenCalledWith(
      "team",
      "agent.member_invited",
      { tool: "member_invite", approval: "granted", teamId: "t1" },
      undefined,
    );
    expect(res).toEqual({ ok: true, result: { status: "invited", key: null } });
  });

  it("keeps the invited address out of the audit row", async () => {
    const { ports, audit } = makePorts();
    await tool(ports, "member_invite").execute({ teamId: "t1", email: "b@example.com" });
    expect(JSON.stringify(audit.mock.calls[0])).not.toContain("b@example.com");
  });

  it("member_remove and member_set_role audit their own action and return a null result", async () => {
    const { ports, team, audit } = makePorts();
    expect(await tool(ports, "member_remove").execute({ teamId: "t1", userId: "u2" }))
      .toEqual({ ok: true, result: null });
    expect(team.removeMember).toHaveBeenCalledWith("t1", "u2");
    expect(audit.mock.calls[0][1]).toBe("agent.member_removed");

    expect(await tool(ports, "member_set_role").execute({ teamId: "t1", userId: "u2", role: "r1" }))
      .toEqual({ ok: true, result: null });
    expect(team.setMemberRole).toHaveBeenCalledWith("t1", "u2", "r1");
    expect(audit.mock.calls[1][1]).toBe("agent.member_role_changed");
    // The target user is on both rows: a membership trail that cannot say who
    // was removed or re-roled records nothing worth reviewing.
    expect(audit.mock.calls[0][2]).toEqual({
      tool: "member_remove", approval: "granted", teamId: "t1", userId: "u2",
    });
    expect(audit.mock.calls[1][2]).toEqual({
      tool: "member_set_role", approval: "granted", teamId: "t1", userId: "u2",
    });
  });

  it("a rejected approval never reaches the API and writes no audit row", async () => {
    const { ports, team, audit } = makePorts({}, false);
    expect(await tool(ports, "member_remove").execute({ teamId: "t1", userId: "u2" }))
      .toEqual({ refused: true, error: "rejected by user", reason: "no" });
    expect(team.removeMember).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("returns a domain refusal as a refusal, never wrapped in a success", async () => {
    const { ports } = makePorts({
      setMemberRole: vi.fn(async () => ({ ok: false as const, error: "no such member in that team" })),
    });
    expect(await tool(ports, "member_set_role").execute({ teamId: "t1", userId: "u9", role: "r1" }))
      .toEqual({ refused: true, error: "no such member in that team" });
  });

  it("returns a thrown API failure as a refusal", async () => {
    const { ports } = makePorts({ removeMember: vi.fn(async () => { throw new Error("offline"); }) });
    expect(await tool(ports, "member_remove").execute({ teamId: "t1", userId: "u2" }))
      .toEqual({ refused: true, error: "offline" });
  });

  it("member_set_role takes a role id or name, and an invite by id names the user on its row", async () => {
    const { ports, team, audit } = makePorts();
    expect(tool(ports, "member_set_role").schema.safeParse({ teamId: "t1", userId: "u2", role: "manager" }).success)
      .toBe(true);
    await tool(ports, "member_set_role").execute({ teamId: "t1", userId: "u2", role: "manager" });
    expect(team.setMemberRole).toHaveBeenCalledWith("t1", "u2", "manager");

    await tool(ports, "member_invite").execute({ teamId: "t1", userId: "u3" });
    expect(audit.mock.calls[1][2]).toEqual({
      tool: "member_invite", approval: "granted", teamId: "t1", userId: "u3",
    });
  });

  it("member_invite rejects neither-or-both of email and userId at the schema", () => {
    const { ports } = makePorts();
    const { schema } = tool(ports, "member_invite");
    expect(schema.safeParse({ teamId: "t1" }).success).toBe(false);
    expect(schema.safeParse({ teamId: "t1", email: "b@example.com", userId: "u2" }).success).toBe(false);
    expect(schema.safeParse({ teamId: "t1", userId: "u2" }).success).toBe(true);
  });
});
