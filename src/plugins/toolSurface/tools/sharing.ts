import { z } from "zod";
import type { DomainResult, PluginAuditAction } from "@/plugins/api";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate, mayAct, objectOp, unwrapDomain } from "./helpers";
import { refusal } from "../refusal";

export const SHARING_PERMISSIONS = ["sharing:read", "sharing:write"] as const;

export function buildSharingTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);

  const notOwned = () =>
    refusal(ports.text?.notOwnedError
      ?? "that session was not opened by you; sharing acts only on sessions you opened");

  /**
   * Approve, record, then run a sharing write against a session the agent
   * opened itself.
   *
   * Ownership is checked on both sides of the gate, like the pane verbs:
   * before it so an unowned session is refused rather than raising a card for
   * a doomed call, and after it because an approval can sit pending while the
   * session closes or changes hands. A session the user opened has no
   * ownership row, and that absence is the whole of what keeps an agent from
   * sharing the user's own terminal.
   */
  const ownedOp = async (
    tool: string,
    action: PluginAuditAction,
    raw: Record<string, unknown>,
    meta: Record<string, unknown>,
    run: (args: Record<string, unknown>) => Promise<DomainResult<unknown>>,
    /** A doomed-call test made before the card is raised, like sessionGate's.
     *  Anything truthy it returns is the verb's result. */
    precheck?: (sessionId: string) => unknown,
  ): Promise<unknown> => {
    if (!mayAct(ports, String(raw.sessionId))) return notOwned();
    const refused = precheck?.(String(raw.sessionId));
    if (refused) return refused;
    // sessionId comes from the pre-gate args, same hazard as sessionGate's
    // scope (helpers.ts): correct only while no decision can rewrite it.
    return op(tool, action, { sessionId: String(raw.sessionId), ...meta }, raw, async (a) => {
      if (!mayAct(ports, String(a.sessionId))) return notOwned();
      return unwrapDomain(await run(a));
    });
  };

  return [
    {
      name: "list_shared_sessions",
      description:
        "List the terminal sessions shared with or by you: each one's participants, who currently "
        + "holds control, and who is asking for it. agentOwned says whether you opened that "
        + "session yourself — the sharing writes act only on those.",
      risk: "auto",
      schema: z.object({}),
      // `owned.has`, never `mayAct`: this is a read, and `mayAct` adopts the
      // session as a side effect.
      execute: async () => (await ports.api.sharing.list()).map((s) => ({
        ...s,
        agentOwned: s.localSessionId !== null && ports.owned.has(s.localSessionId),
      })),
    },
    {
      name: "share_session",
      description:
        "Share a session you opened with one or more team vaults, so their members can watch it and "
        + "request control. Refused for a tab with broadcast typing enabled, because the user's own "
        + "keystrokes would reach every participant. Invite links are not available to agents — "
        + "sharing is scoped to named team members. Prompts the user.",
      risk: "prompt",
      schema: z.object({
        sessionId: z.string(),
        vaultIds: z.array(z.string()).min(1),
        allowedRoles: z.array(z.string()).optional(),
      }),
      execute: async (raw) =>
        ownedOp(
          "share_session", "agent.session_shared", raw, { vaultIds: raw.vaultIds },
          (a) => ports.api.sharing.share({
            sessionId: String(a.sessionId),
            vaultIds: a.vaultIds as string[],
            allowedRoles: a.allowedRoles as string[] | undefined,
          }),
          // Before the gate and before the audit row: a share refused for
          // broadcast must raise no approval card and record no act that never
          // happened. The predicate stays single, in the sharing domain.
          (sessionId) => {
            const reason = ports.api.sharing.shareRefusal(sessionId);
            return reason ? refusal(reason) : undefined;
          },
        ),
    },
    {
      name: "unshare_session",
      description:
        "Stop sharing a session you opened. Every participant is disconnected from it. Prompts the user.",
      risk: "prompt",
      schema: z.object({ sessionId: z.string() }),
      execute: async (raw) =>
        ownedOp("unshare_session", "agent.session_unshared", raw, {}, (a) =>
          ports.api.sharing.unshare(String(a.sessionId))),
    },
    {
      name: "handoff_control",
      description:
        "Give terminal control to a participant who has requested it. Refused when that user has no "
        + "pending request — control is never handed to someone who did not ask for it. Prompts the user.",
      risk: "prompt",
      schema: z.object({ sessionId: z.string(), userId: z.string() }),
      execute: async (raw) =>
        ownedOp("handoff_control", "agent.control_granted", raw, { userId: String(raw.userId) }, (a) =>
          ports.api.sharing.handoffControl(String(a.sessionId), String(a.userId))),
    },
  ];
}
