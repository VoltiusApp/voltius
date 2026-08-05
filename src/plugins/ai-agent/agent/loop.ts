import { streamText, stepCountIs, tool, type LanguageModel, type ModelMessage } from "ai";
import type { z } from "zod";
import type { AgentContext } from "../tools/registry";
import { buildTools } from "../tools/registry";
import { TERMINAL_DOCTOR_SYSTEM_PROMPT } from "./systemPrompt";

export interface RunAgentOptions {
  model: LanguageModel;
  ctx: AgentContext;
  messages: ModelMessage[];
  maxSteps?: number;
  abortSignal?: AbortSignal;
}

/**
 * Drive the Terminal Doctor agent loop. Uses the AI SDK's built-in agentic
 * multi-step loop (streamText + stopWhen); approval is enforced *inside* each
 * prompt-risk tool's execute (see buildTools), so the loop itself stays thin.
 */
export function runAgent(opts: RunAgentOptions) {
  const agentTools = buildTools(opts.ctx);
  const toolSet = Object.fromEntries(
    agentTools.map((t) => [
      t.name,
      tool<Record<string, unknown>, unknown, Record<string, unknown>>({
        description: t.description,
        // AgentTool.schema is deliberately typed as the broad `z.ZodType`
        // (Task 5) since each tool's shape differs; narrow it here at the
        // ai-sdk adapter boundary rather than loosening the registry's type.
        inputSchema: t.schema as unknown as z.ZodType<Record<string, unknown>>,
        execute: (args: Record<string, unknown>) => t.execute(args),
      }),
    ]),
  );

  return streamText({
    model: opts.model,
    system: TERMINAL_DOCTOR_SYSTEM_PROMPT,
    messages: opts.messages,
    tools: toolSet,
    stopWhen: stepCountIs(opts.maxSteps ?? 12),
    abortSignal: opts.abortSignal,
  });
}
