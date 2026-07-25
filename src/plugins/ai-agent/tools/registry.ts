import { z } from "zod";
import type { PluginAPI } from "@/plugins/api";
import type { ApprovalVia, ToolDecision, ToolRisk } from "../types";
import { captureCommand } from "./capture";

export interface AgentContext {
  api: PluginAPI;
  approve(call: { tool: string; args: Record<string, unknown> }): Promise<ToolDecision>;
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
        const g = await gate("open_session", raw);
        if (!g.ok) return g.result;
        const connectionId = String(g.args.connectionId);
        const sessionId = await ctx.api.sessions.open(connectionId);
        ctx.owned.add(sessionId);
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
        return { closed: sessionId };
      },
    },
  ];
}
