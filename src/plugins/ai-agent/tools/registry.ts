import { z } from "zod";
import type { PluginAPI } from "@/plugins/api";
import type { ApprovalVia, ToolDecision, ToolRisk } from "../types";
import { auditAgentAction } from "../state/auditSeam";
import {
  MAX_PLAN_COMMAND_CHARS,
  MAX_PLAN_ID_CHARS,
  MAX_PLAN_RATIONALE_CHARS,
  MAX_PLAN_STEPS,
  type PlanStep,
  type PlanStepTool,
  type PlanVerdict,
} from "../state/planTokens";
import { captureCommand } from "./capture";
import { guardConnectionId } from "./connectionGuard";

export interface AgentContext {
  api: PluginAPI;
  approve(call: { tool: string; args: Record<string, unknown> }): Promise<ToolDecision>;
  /** Park a checklist for the user and resolve with their verdict. Blocks for
   *  as long as an approval card would — deliberately, so proposal and
   *  execution stay inside ONE generation and every existing abort/supersede
   *  guard applies unchanged. */
  proposePlan(steps: PlanStep[]): Promise<PlanVerdict>;
  owned: Set<string>;
}

export interface AgentTool {
  name: string;
  description: string;
  schema: z.ZodType;
  risk: ToolRisk;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

/** Build the v1 Terminal Doctor tool set bound to one agent context. */
export function buildTools(ctx: AgentContext): AgentTool[] {
  /** Run the approval port for a prompt-risk tool; returns final args or a rejection. */
  const gate = async (
    tool: string,
    args: Record<string, unknown>,
  ): Promise<
    | { ok: true; args: Record<string, unknown>; scope: string; via: ApprovalVia }
    | { ok: false; result: unknown }
  > => {
    const decision = await ctx.approve({ tool, args });
    if (!decision.approve) return { ok: false, result: { error: "rejected by user", reason: decision.reason } };
    return { ok: true, args: decision.args ?? args, scope: decision.scope, via: decision.via };
  };

  return [
    {
      name: "propose_plan",
      description:
        "Propose a checklist of steps for the user to review and approve before anything runs. Use this when you are in plan mode, or whenever you want several steps authorized together. Each step names a CONNECTION id from list_connections, never a session id — sessions do not exist until the plan is approved and open_session runs. Returns the user's verdict; when approved, execute exactly the steps returned, in order.",
      risk: "auto",
      schema: z.object({
        steps: z
          .array(
            z.object({
              tool: z.enum(["open_session", "run_command", "close_session"]),
              connectionId: z.string().min(1).max(MAX_PLAN_ID_CHARS),
              command: z.string().max(MAX_PLAN_COMMAND_CHARS).optional(),
              rationale: z.string().max(MAX_PLAN_RATIONALE_CHARS),
            }),
          )
          .min(1)
          .max(MAX_PLAN_STEPS),
      }),
      execute: async (raw) => {
        const proposed = (raw.steps ?? []) as Array<{
          tool: PlanStepTool;
          connectionId: string;
          command?: string;
          rationale: string;
        }>;
        // Ids are assigned HERE and are absent from the schema above, so the
        // model cannot supply them. They key the token -> checklist-row
        // mapping, and a forged or duplicated id would let one step's
        // execution tick a different step's row.
        const steps: PlanStep[] = proposed.map((s, i) => ({ ...s, id: `step-${i + 1}` }));
        const verdict = await ctx.proposePlan(steps);
        if (verdict.approve === false) {
          return { approved: false, reason: verdict.reason ?? "rejected by user" };
        }
        return {
          approved: true,
          preAuthorized: verdict.approve === "run",
          // The FINAL steps — post-edit, post-removal. Echoing what was
          // proposed would make an edited step miss its token and raise a
          // card, defeating the edit and confusing the user about why an
          // approved step is asking again.
          steps: verdict.steps.map((s) => ({
            tool: s.tool,
            connectionId: s.connectionId,
            command: s.command,
          })),
        };
      },
    },
    {
      name: "list_connections",
      description: "List the user's saved SSH/host connections (id, name, host).",
      risk: "auto",
      schema: z.object({}),
      execute: async () => {
        const conns = await ctx.api.connections.list();
        return conns.map((c) => ({ id: c.id, name: c.name, host: c.host }));
      },
    },
    {
      name: "open_session",
      description: "Open a dedicated agent workbench session on a connection. Prompts the user.",
      risk: "prompt",
      schema: z.object({ connectionId: z.string() }),
      execute: async (raw) => {
        // Before the gate, deliberately: an id that matches no connection can
        // never be scoped or pre-authorized, so carding it would ask the user
        // to authorize an action that is already doomed.
        const guard = await guardConnectionId(ctx.api, String(raw.connectionId));
        if (!guard.ok) return guard.result;
        const g = await gate("open_session", raw);
        if (!g.ok) return g.result;
        const connectionId = String(g.args.connectionId);
        const sessionId = await ctx.api.sessions.open(connectionId);
        ctx.owned.add(sessionId);
        // After the open succeeds: a failed open produced no session, so there
        // is nothing to record.
        auditAgentAction(g.scope, "agent.session_opened", { tool: "open_session", approval: g.via });
        return { sessionId };
      },
    },
    {
      name: "run_command",
      description:
        "Run a shell command in an agent-owned session and capture its output + exit code. Prompts for every command. Only works in a session opened via open_session.",
      risk: "prompt",
      schema: z.object({ sessionId: z.string(), command: z.string() }),
      execute: async (raw) => {
        if (!ctx.owned.has(String(raw.sessionId))) {
          return { error: "session not owned by agent; call open_session first" };
        }
        const g = await gate("run_command", raw);
        if (!g.ok) return g.result;
        const sessionId = String(g.args.sessionId);
        const command = String(g.args.command);
        if (!ctx.owned.has(sessionId)) return { error: "session not owned by agent; call open_session first" };
        // Recorded BEFORE dispatch, deliberately: the command reaches the
        // shell whether or not the capture comes back, and a crash mid-capture
        // must not erase the record of something that actually ran.
        //
        // `g.scope` is derived from `raw.sessionId` (the ORIGINAL args passed
        // to `gate`), not from `g.args.sessionId` (what actually executes,
        // below). Those are the same value today only because nothing lets a
        // decision rewrite `sessionId`: the approval card's edit form offers
        // inputs for `command` and `connectionId` only. If `sessionId` ever
        // becomes editable, this line must re-derive scope from the executed
        // session, or the audit record could name a different connection than
        // the one the command actually ran on.
        auditAgentAction(g.scope, "agent.command_run", { tool: "run_command", approval: g.via }, { command });
        return captureCommand(ctx.api, sessionId, command, {});
      },
    },
    {
      name: "read_terminal",
      description: "Read the last N lines of a terminal session's buffer (the user's session or the workbench).",
      risk: "auto",
      schema: z.object({ sessionId: z.string(), maxLines: z.number().int().positive().optional() }),
      execute: async (raw) => ctx.api.terminal.readSnapshot(String(raw.sessionId), raw.maxLines as number | undefined),
    },
    {
      name: "close_session",
      description: "Close an agent-owned workbench session.",
      risk: "prompt",
      schema: z.object({ sessionId: z.string() }),
      execute: async (raw) => {
        if (!ctx.owned.has(String(raw.sessionId))) {
          return { error: "session not owned by agent; call open_session first" };
        }
        const g = await gate("close_session", raw);
        if (!g.ok) return g.result;
        const sessionId = String(g.args.sessionId);
        if (!ctx.owned.has(sessionId)) return { error: "session not owned by agent; call open_session first" };
        await ctx.api.sessions.close(sessionId);
        ctx.owned.delete(sessionId);
        auditAgentAction(g.scope, "agent.session_closed", { tool: "close_session", approval: g.via });
        return { closed: sessionId };
      },
    },
  ];
}
