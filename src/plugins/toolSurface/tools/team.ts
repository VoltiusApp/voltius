import { z } from "zod";
import type { DomainResult, PluginAuditAction } from "@/plugins/api";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate, objectOp, unwrapDomain } from "./helpers";

export const TEAM_PERMISSIONS = ["team:read", "team:write"] as const;

const optionalString = (value: unknown): string | undefined => (value === undefined ? undefined : String(value));

export function buildTeamTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);

  /**
   * Approve, record, then run a team write. Every one of them is scoped by
   * teamId and declines by returning rather than throwing, so the audit meta
   * and the unwrap are the same for all three.
   */
  const teamOp = (
    tool: string,
    action: PluginAuditAction,
    raw: Record<string, unknown>,
    run: (args: Record<string, unknown>) => Promise<DomainResult<unknown>>,
  ): Promise<unknown> =>
    op(tool, action, { teamId: String(raw.teamId) }, raw, async (a) => unwrapDomain(await run(a)));

  return [
    {
      name: "team_list",
      description:
        "List the teams you belong to, your roles in each, and each team vault's current status.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => ports.api.team.list(),
    },
    {
      name: "member_list",
      description:
        "List a team's members and its pending invitations. Each row is tagged state: member or pending.",
      risk: "auto",
      schema: z.object({ teamId: z.string() }),
      execute: async (raw) => ports.api.team.members(String(raw.teamId)),
    },
    {
      name: "vault_key_status",
      description:
        "Report team vault key distribution: for each member, whether they have published a public "
        + "key and whether they hold a wrapped vault key. A member with a public key but no wrapped "
        + "key cannot read the team vault yet. Omit teamId for every team you can see.",
      risk: "auto",
      schema: z.object({ teamId: z.string().optional() }),
      execute: async (raw) => ports.api.team.keyStatus(optionalString(raw.teamId)),
    },
    {
      name: "member_invite",
      description:
        "Invite someone to a team by email, or add an existing user by id — exactly one of the two. "
        + "Requires your team role to allow it. Prompts the user.",
      risk: "prompt",
      schema: z
        .object({
          teamId: z.string(),
          email: z.string().optional(),
          userId: z.string().optional(),
          role: z.string().optional(),
        })
        .refine((a) => Boolean(a.email) !== Boolean(a.userId), {
          message: "give exactly one of email or userId",
        }),
      execute: async (raw) =>
        teamOp("member_invite", "agent.member_invited", raw, (a) =>
          ports.api.team.invite({
            teamId: String(a.teamId),
            email: optionalString(a.email),
            userId: optionalString(a.userId),
            role: optionalString(a.role),
          })),
    },
    {
      name: "member_remove",
      description:
        "Remove a member from a team. They lose access to the team vault. Prompts the user.",
      risk: "prompt",
      schema: z.object({ teamId: z.string(), userId: z.string() }),
      execute: async (raw) =>
        teamOp("member_remove", "agent.member_removed", raw, (a) =>
          ports.api.team.removeMember(String(a.teamId), String(a.userId))),
    },
    {
      name: "member_set_role",
      description:
        "Replace a member's roles in a team with one role. Call team_list for role names. "
        + "Prompts the user.",
      risk: "prompt",
      schema: z.object({ teamId: z.string(), userId: z.string(), roleId: z.string() }),
      execute: async (raw) =>
        teamOp("member_set_role", "agent.member_role_changed", raw, (a) =>
          ports.api.team.setMemberRole(String(a.teamId), String(a.userId), String(a.roleId))),
    },
  ];
}
