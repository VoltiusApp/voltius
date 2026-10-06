import { z } from "zod";
import type { PluginPanePosition, PluginPaneResult } from "@/plugins/api";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate, mayAct } from "./helpers";
import { refusal } from "../refusal";

export const PANE_PERMISSIONS = ["panes:read", "panes:write"] as const;

const position = z.enum(["left", "right", "top", "bottom"]);
const pair = z.object({ sessionId: z.string(), targetSessionId: z.string(), position });

/** Shared by both rename verbs: what an agent reads before it renames, and why the escape fallback fails. */
const RENAME_NOTES =
  "An empty title clears the name. Long names are cut; the returned tab shows what was stored. "
  + "A title escape written to the terminal (OSC 0/2) never changes a Voltius label, so use this "
  + "verb rather than printf-ing one.";

/** The text both rename verbs give the model, ending in the consumer's own approval sentence. */
export function renameDescriptions(approval: string): { pane_rename: string; tab_rename: string } {
  return {
    pane_rename:
      "Name a session you opened: the label on its tab and its pane header, shown in place of the "
      + "connection name. A session the user opened is refused — its name is the user's, and it is "
      + `how they tell their shells apart. ${RENAME_NOTES} ${approval}`,
    tab_rename:
      "Name a split tab whose every pane is a session you opened. `tabId` is a split tab's id from "
      + "pane_list. Unnamed, a split tab is labelled after its focused pane. A standalone tab is "
      + `labelled with its session's name; use pane_rename for it. ${RENAME_NOTES} ${approval}`,
  };
}

/** The `{ sessionId, targetSessionId, position }` args both pair verbs project onto their API call. */
const pairArgs = (args: Record<string, unknown>) => ({
  sessionId: String(args.sessionId),
  targetSessionId: String(args.targetSessionId),
  position: args.position as PluginPanePosition,
});

export function buildPaneTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const descriptions = renameDescriptions("Prompts the user.");

  /** A refusal when the caller may not act on these args, else null. */
  type Guard = (args: Record<string, unknown>) => unknown;

  const sessionOwned: Guard = (args) =>
    mayAct(ports, String(args.sessionId))
      ? null
      : refusal(ports.text?.notOwnedError
        ?? "that session was not opened by you; only pane_focus and pane_list accept another session");

  /**
   * A tab's label sits over every pane in it, so every one must be the caller's.
   * An unknown tab holds nothing to own and passes, leaving the API to refuse
   * it — as pane_focus does for an unknown session.
   */
  const tabOwned: Guard = (args) => {
    const tab = ports.api.panes.list().find((t) => t.tabId === String(args.tabId));
    const mine = (tab?.panes ?? []).every((pane) => mayAct(ports, pane.sessionId));
    return mine ? null : refusal("that tab holds a session you did not open; tab_rename needs every pane in it to be yours");
  };

  /**
   * Approve, then run a pane write and translate the domain's refusal.
   *
   * No audit row, deliberately: a layout change or a label reads nothing and
   * destroys nothing, and everything done inside those panes is already
   * audited by its own verb. `guard` runs before the gate so an unowned target
   * is refused rather than raising an approval card for a doomed call, and
   * again on the approved args.
   */
  const write = async (
    tool: string,
    raw: Record<string, unknown>,
    run: (args: Record<string, unknown>) => PluginPaneResult,
    guard: Guard | null = sessionOwned,
  ): Promise<unknown> => {
    const before = guard?.(raw);
    if (before) return before;
    const g = await gate(tool, raw);
    if (!g.ok) return g.result;
    const after = guard?.(g.args);
    if (after) return after;
    const result = run(g.args);
    return result.ok ? { ok: true, result: result.tab } : refusal(result.error);
  };

  return [
    {
      name: "pane_list",
      description:
        "List the terminal tabs and the panes inside them: which session sits in which pane, which "
        + "is focused, and which is maximized. A tab that is not split is reported as a single-pane "
        + "tab, so the whole tab strip reads as one list. `title` is a name given by the user or "
        + "with pane_rename / tab_rename; null means the label is the connection name (on a split "
        + "tab, the focused pane's label).",
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
          null,
        ),
    },
    {
      name: "pane_rename",
      description: descriptions.pane_rename,
      risk: "prompt",
      schema: z.object({ sessionId: z.string(), title: z.string() }),
      execute: async (raw) =>
        write("pane_rename", raw, (args) => ports.api.panes.rename(String(args.sessionId), String(args.title))),
    },
    {
      name: "tab_rename",
      description: descriptions.tab_rename,
      risk: "prompt",
      schema: z.object({ tabId: z.string(), title: z.string() }),
      execute: async (raw) =>
        write("tab_rename", raw, (args) => ports.api.panes.renameTab(String(args.tabId), String(args.title)), tabOwned),
    },
  ];
}
