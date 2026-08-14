import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { makeGate, objectOp, unwrapDomain } from "./helpers";

export const MARKETPLACE_PERMISSIONS = ["plugins:manage"] as const;

/** Origin only, for the audit row — never the path or query string. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "invalid";
  }
}

export function buildMarketplaceTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);

  return [
    {
      name: "marketplace_search",
      description:
        "Search the plugin catalog across the marketplace sources the user has enabled. Matches id, "
        + "name, description, author and tags; with no query, returns everything. Each entry carries "
        + "the version on offer — install it with plugin_install.",
      risk: "auto",
      schema: z.object({ query: z.string().optional() }),
      execute: async (raw) => ports.api.plugins.search(raw.query as string | undefined),
    },
    {
      name: "marketplace_source_list",
      description:
        "The marketplace sources this app reads plugins from, whether each is enabled, and whether "
        + "it can be removed. The built-in Voltius source cannot.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => ports.api.plugins.sources(),
    },
    {
      name: "marketplace_source_add",
      description:
        "Add a marketplace source by catalog URL. This is a lasting trust decision, not a one-off: "
        + "every plugin the user installs from it afterwards comes from that URL.",
      risk: "prompt",
      schema: z.object({ url: z.string() }),
      execute: async (raw) =>
        op("marketplace_source_add", "agent.marketplace_source_changed",
          // Origin only: a private catalog URL can carry auth material in its
          // query string, and the audit row must not hold it in clear.
          (a) => ({ url: originOf(String(a.url)), change: "added" }), raw, async (a) =>
            unwrapDomain(await ports.api.plugins.addSource(String(a.url)))),
    },
    {
      name: "marketplace_source_remove",
      description:
        "Remove a custom marketplace source. Plugins already installed from it stay installed. "
        + "Refuses on the built-in source.",
      risk: "prompt",
      schema: z.object({ id: z.string() }),
      execute: async (raw) =>
        op("marketplace_source_remove", "agent.marketplace_source_changed",
          (a) => ({ id: String(a.id), change: "removed" }), raw, async (a) =>
            unwrapDomain(await ports.api.plugins.removeSource(String(a.id)))),
    },
  ];
}
