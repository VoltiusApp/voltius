import { z } from "zod";
import {
  buildCoreTools,
  guardPlanConnectionIds,
  type Tool,
  type ToolSurfacePorts,
} from "@voltius/tools";
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

export type AgentTool = Tool;

export interface AgentContext extends Omit<ToolSurfacePorts, "audit"> {
  /** Park a checklist for the user and resolve with their verdict. Blocks for
   *  as long as an approval card would — deliberately, so proposal and
   *  execution stay inside ONE generation and every existing abort/supersede
   *  guard applies unchanged. */
  proposePlan(steps: PlanStep[]): Promise<PlanVerdict>;
}

function proposePlanTool(ctx: AgentContext): AgentTool {
  return {
    name: "propose_plan",
    description:
      "Propose a checklist of steps for the user to review and approve before anything runs. Use this when you are in plan mode, or whenever you want several steps authorized together. Each step names a CONNECTION id from list_connections, copied verbatim — a name or hostname is rejected and the whole plan is refused. Never a session id: sessions do not exist until the plan is approved and open_session runs. Returns the user's verdict; when approved, execute exactly the steps returned, in order.",
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
      // The whole plan, not just the bad steps: dropping steps would silently
      // change the model's plan behind its back, and parking it badged would
      // leave "Approve & run" authorizing nothing. The model can fix an id;
      // it cannot fix a shell metacharacter, which is what the badge is for.
      const guard = await guardPlanConnectionIds(ctx.api, steps.map((s) => s.connectionId));
      if (!guard.ok) return guard.result;
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
  };
}

/** The agent's tool set: the shared verbs plus its own planning tool. */
export function buildTools(ctx: AgentContext): AgentTool[] {
  return [
    proposePlanTool(ctx),
    ...buildCoreTools({ ...ctx, audit: auditAgentAction }),
  ];
}
