import { z } from "zod";
import type { PluginPanePosition, PluginPaneResult } from "@/plugins/api";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate, mayAct } from "./helpers";
import { refusal } from "../refusal";

export const PANE_PERMISSIONS = ["panes:read", "panes:write"] as const;

const position = z.enum(["left", "right", "top", "bottom"]);
const pair = z.object({ sessionId: z.string(), targetSessionId: z.string(), position });

/** The `{ sessionId, targetSessionId, position }` args both pair verbs project onto their API call. */
const pairArgs = (args: Record<string, unknown>) => ({
  sessionId: String(args.sessionId),
  targetSessionId: String(args.targetSessionId),
  position: args.position as PluginPanePosition,
});

export function buildPaneTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);

  const notOwned = () =>
    refusal(ports.text?.notOwnedError
      ?? "that session was not opened by you; only pane_focus and pane_list accept another session");

  /**
   * Approve, then run a layout write and translate the domain's refusal.
   *
   * No audit row, deliberately: a layout change reads nothing and destroys
   * nothing, and everything done inside those panes is already audited by its
   * own verb. `owned` is checked before the gate so an unowned session is
   * refused rather than raising an approval card for a doomed call.
   */
  const write = async (
    tool: string,
    raw: Record<string, unknown>,
    run: (args: Record<string, unknown>) => PluginPaneResult,
    requireOwned = true,
  ): Promise<unknown> => {
    if (requireOwned && !mayAct(ports, String(raw.sessionId))) return notOwned();
    const g = await gate(tool, raw);
    if (!g.ok) return g.result;
    if (requireOwned && !mayAct(ports, String(g.args.sessionId))) return notOwned();
    const result = run(g.args);
    return result.ok ? { ok: true, result: result.tab } : refusal(result.error);
  };

  return [
    {
      name: "pane_list",
      description:
        "List the terminal tabs and the panes inside them: which session sits in which pane, which "
        + "is focused, and which is maximized. A tab that is not split is reported as a single-pane "
        + "tab, so the whole tab strip reads as one list.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => ({
        tabs: ports.api.panes.list().map((tab) => ({
          ...tab,
          panes: tab.panes.map((pane) => ({ ...pane, ownedByCaller: ports.owned.has(pane.sessionId) })),
        })),
      }),
    },
    {
      name: "pane_split",
      description:
        "Put a session you opened into a split pane beside another session, which may be one of the "
        + "user's own. `position` is where the incoming session lands relative to the target. Use "
        + "session_move_to_pane instead for a session that is already in a split tab. Prompts the user.",
      risk: "prompt",
      schema: pair,
      execute: async (raw) =>
        write("pane_split", raw, (args) => ports.api.panes.split(pairArgs(args))),
    },
    {
      name: "session_move_to_pane",
      description:
        "Move a session you opened next to another session, within the same split tab or across "
        + "tabs. Prompts the user.",
      risk: "prompt",
      schema: pair,
      execute: async (raw) =>
        write("session_move_to_pane", raw, (args) => ports.api.panes.move(pairArgs(args))),
    },
    {
      name: "pane_detach",
      description:
        "Take a session you opened out of its split tab. The session stays open and becomes its own "
        + "tab; use close_session to end it. Prompts the user.",
      risk: "prompt",
      schema: z.object({ sessionId: z.string() }),
      execute: async (raw) =>
        write("pane_detach", raw, (args) => ports.api.panes.detach(String(args.sessionId))),
    },
    {
      name: "pane_focus",
      description:
        "Bring a session's pane to the front so the user sees it, optionally maximizing it within "
        + "its tab. Works on any open session, changes only what is visible. `maximize: true` is "
        + "refused for a session that is not in a split tab, because there is no pane to maximize. "
        + "Prompts the user.",
      risk: "prompt",
      schema: z.object({ sessionId: z.string(), maximize: z.boolean().optional() }),
      execute: async (raw) =>
        write(
          "pane_focus",
          raw,
          (args) => ports.api.panes.focus(String(args.sessionId), args.maximize as boolean | undefined),
          false,
        ),
    },
  ];
}
