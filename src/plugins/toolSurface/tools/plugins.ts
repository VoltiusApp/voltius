import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import type { DomainResult } from "@/plugins/api";
import { refusal } from "../refusal";
import { makeGate, objectOp, unwrapDomain, idOp } from "./helpers";

export const PLUGIN_PERMISSIONS = ["plugins:manage"] as const;

// Shared with the domain (src/plugins/domains/plugins.ts), which imports these
// back so the refusal text has one source of truth: the tool layer pre-checks
// the same doomed calls the domain guards, to avoid a false audit row, and
// the wording must not drift between the two checks.
export const noSuchPluginMessage = (id: string) =>
  `no such plugin "${id}"; call plugin_list for the installed ids`;

export const unknownConfigKeyMessage = (id: string, known: string[], key: string) =>
  known.length === 0
    ? `"${id}" declares no configuration`
    : `"${id}" declares no setting "${key}"; it declares ${known.join(", ")}`;

export function buildPluginTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);

  /** Doomed before the gate: an id naming no installed plugin. */
  const requireExisting = async (id: string): Promise<unknown> => {
    const plugins = await ports.api.plugins.list();
    return plugins.some((p) => p.id === id) ? undefined : refusal(noSuchPluginMessage(id));
  };

  /** The three lifecycle verbs differ only by id, action and store call. */
  const lifecycle = (
    name: string,
    action: "agent.plugin_installed" | "agent.plugin_removed" | "agent.plugin_updated",
    description: string,
    run: (id: string) => Promise<DomainResult<unknown>>,
    precheck?: (id: string) => Promise<unknown>,
  ): Tool => ({
    name,
    description,
    risk: "prompt",
    schema: z.object({ id: z.string() }),
    execute: idOp(op, name, action, run, { idKey: "pluginId", precheck }),
  });

  const toggle = (name: string, enabled: boolean, description: string): Tool => ({
    name,
    description,
    risk: "prompt",
    schema: z.object({ id: z.string() }),
    execute: idOp(
      op, name, enabled ? "agent.plugin_enabled" : "agent.plugin_disabled",
      (id) => ports.api.plugins.setEnabled(id, enabled),
      { idKey: "pluginId", precheck: requireExisting },
    ),
  });

  return [
    {
      name: "plugin_list",
      description:
        "The plugins installed in this app: id, name, version, whether each is enabled, where it "
        + "came from (bundled with the app, a marketplace, a URL, or a local folder), its content "
        + "hash, the permissions it declares, which of its settings can be configured, and the "
        + "version available if an update exists.",
      risk: "auto",
      schema: z.object({}),
      execute: async () => ports.api.plugins.list(),
    },
    lifecycle(
      "plugin_install", "agent.plugin_installed",
      "Install a plugin from the marketplace catalog by id. The plugin's code runs inside the app "
      + "with the permissions its manifest declares; call marketplace_search first and read them. "
      + "Refuses an id that is in no enabled source.",
      (id) => ports.api.plugins.install(id),
    ),
    lifecycle(
      "plugin_uninstall", "agent.plugin_removed",
      "Remove an installed plugin. Plugins bundled with the app can be removed too and stay "
      + "reinstallable afterwards.",
      (id) => ports.api.plugins.uninstall(id),
      requireExisting,
    ),
    toggle("plugin_enable", true,
      "Enable an installed plugin and load it. Its contributed tools appear after this."),
    toggle("plugin_disable", false,
      "Disable an installed plugin and unload it, without removing it. Its contributed tools stop "
      + "working."),
    lifecycle(
      "plugin_update", "agent.plugin_updated",
      "Update an installed plugin to the version its marketplace source offers. Refuses, naming "
      + "the installed version, when there is nothing newer.",
      (id) => ports.api.plugins.update(id),
      requireExisting,
    ),
    {
      name: "plugin_configure",
      description:
        "Read or change a plugin's settings. Only the settings a plugin declares in its manifest "
        + "are reachable — its internal storage is not. Called with an id alone, returns the "
        + "declared settings and their current values; called with a key and a value, writes one. "
        + "A plugin that declares no settings is refused by name.",
      risk: "prompt",
      schema: z.object({ id: z.string(), key: z.string().optional(), value: z.unknown().optional() }),
      execute: async (raw) => {
        const id = String(raw.id);
        // Read path: no write, no card, no audit row.
        if (raw.key === undefined && raw.value === undefined) {
          return unwrapDomain(await ports.api.plugins.config(id));
        }
        // Doomed before the gate, so no approval card is raised for it.
        if (raw.key === undefined) {
          return refusal("plugin_configure needs a key when a value is given");
        }
        const key = String(raw.key);
        // Same doomed-call test config()'s read path applies (unknown id, no
        // declared settings), plus the specific key: refusing here — before
        // the gate — avoids a false "agent.plugin_configured" row and a
        // pointless approval card for a write that was always going to fail.
        const cfg = await ports.api.plugins.config(id);
        if (!cfg.ok) return refusal(cfg.error);
        if (!(key in cfg.result)) return refusal(unknownConfigKeyMessage(id, Object.keys(cfg.result), key));
        return op("plugin_configure", "agent.plugin_configured",
          (a) => ({ pluginId: String(a.id), key: String(a.key) }), raw, async (a) =>
            unwrapDomain(await ports.api.plugins.configure(String(a.id), String(a.key), a.value)));
      },
    },
  ];
}
