import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { refusal } from "../refusal";
import { makeGate, objectOp, unwrapDomain } from "./helpers";

export const SETTINGS_PERMISSIONS = ["settings:read", "settings:write"] as const;

export function buildSettingTools(ports: ToolSurfacePorts): Tool[] {
  const gate = makeGate(ports);
  const op = objectOp(ports, gate);

  return [
    {
      name: "setting_list",
      description:
        "List this app's settings: key, type, allowed values, default, current value, and the "
        + "Settings screen each one lives on. Structured values (keyboard shortcuts, custom "
        + "themes, SFTP column widths) are listed read-only.",
      risk: "auto",
      schema: z.object({
        section: z.string().optional(),
        prefix: z.string().optional(),
        writable_only: z.boolean().optional(),
      }),
      execute: async (raw) =>
        ports.api.settings.list({
          section: raw.section as string | undefined,
          prefix: raw.prefix as string | undefined,
          writableOnly: raw.writable_only as boolean | undefined,
        }),
    },
    {
      name: "setting_get",
      description: "Read one setting by key, with its type, allowed values and current value.",
      risk: "auto",
      schema: z.object({ key: z.string() }),
      execute: async (raw) => {
        const key = String(raw.key);
        const view = ports.api.settings.get(key);
        return view ?? refusal(`Unknown setting "${key}"`);
      },
    },
    {
      name: "setting_set",
      description:
        "Change one setting. The stored value may be normalised or clamped by the app, so the "
        + "result reports the value that actually landed. A few settings turn off a safeguard; "
        + "those refuse once, explain what would be lost, and need confirm: true to proceed. "
        + "Setting toggles.mcp-server to false shuts down this connection and can only be "
        + "turned back on by hand in the app.",
      risk: "prompt",
      schema: z.object({
        key: z.string(),
        value: z.unknown(),
        confirm: z.boolean().optional(),
      }),
      execute: async (raw) => {
        const key = String(raw.key);
        const view = ports.api.settings.get(key);
        if (!view) return refusal(`Unknown setting "${key}"`);

        // Both checks run before the gate, like sessionGate's precheck: a call
        // that is already doomed must not raise an approval card for it. The
        // consequence sentence is itself the refusal — the only place it
        // reaches a human, since the MCP client shows only the verb name and
        // its arguments.
        if (view.consequence && raw.confirm !== true) {
          return refusal(`${view.consequence} Call again with confirm: true to proceed.`, {
            key,
            requiresConfirmation: true,
          });
        }

        return op("setting_set", "agent.setting_changed", { key }, raw, async (a) =>
          unwrapDomain(ports.api.settings.set(String(a.key), a.value)));
      },
    },
  ];
}
