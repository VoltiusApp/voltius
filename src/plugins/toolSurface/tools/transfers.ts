import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate } from "./helpers";
import { refusal } from "../refusal";

export const TRANSFER_PERMISSIONS = ["transfers:read", "transfers:write"] as const;

export function buildTransferTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);

  /** Both mutations share one shape: approve, record, act, and refuse on a bad id. */
  const act = async (
    tool: string,
    raw: Record<string, unknown>,
    run: (id: string) => boolean,
  ): Promise<unknown> => {
    const g = await gate(tool, raw);
    if (!g.ok) return g.result;
    ports.audit(g.scope, "agent.file_transferred", { tool, approval: g.via, id: g.args.id }, undefined);
    return run(String(g.args.id))
      ? { ok: true, result: null }
      : { ok: false, ...refusal("no such transfer, or it is not in a state that allows this; call transfer_list") };
  };

  return [
    {
      name: "transfer_list",
      description:
        "List the file transfers in the app's queue — the user's own and any this server started — "
        + "with their progress, speed and errors. The queue holds the last 30 and is not kept "
        + "across restarts.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => ports.api.transfers.list(),
    },
    {
      name: "transfer_cancel",
      description:
        "Cancel a running file transfer by its `id` from transfer_list, including one the user "
        + "started themselves. Partially written files are left in place.",
      risk: "prompt",
      schema: z.object({ id: z.string() }),
      execute: async (raw) => act("transfer_cancel", raw, (id) => {
        ports.api.transfers.cancel(id);
        return true;
      }),
    },
    {
      name: "transfer_retry",
      description:
        "Run a failed or cancelled transfer again, by its `id` from transfer_list. The retry gets "
        + "a new id; the original stays in the list as history. A running or finished transfer "
        + "cannot be retried.",
      risk: "prompt",
      schema: z.object({ id: z.string() }),
      execute: async (raw) => act("transfer_retry", raw, (id) => ports.api.transfers.retry(id)),
    },
  ];
}
