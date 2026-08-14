import { z } from "zod";
import type { Tool } from "../types";
import type { ToolSurfacePorts } from "../coreTools";
import { refusal } from "../refusal";
import { unknownSetting } from "@/plugins/settingMessages";
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
        return view ?? refusal(unknownSetting(key));
      },
    },
    {
      name: "setting_set",
      description:
        "Change one setting. The stored value may be normalised or clamped by the app, so the "
        + "result reports the value that actually landed. A few settings guard something; "
        + "writing one in the direction that turns the guard off refuses once, explains what "
        + "would be lost, and needs confirm: true to proceed — turning it back on does not. "
        + "Setting toggles.mcp-server to false shuts down this connection and can only be "
        + "turned back on by hand in the app.",
      risk: "prompt",
      schema: z.object({
        key: z.string(),
        value: z.unknown(),
        confirm: z.boolean().optional(),
      }),
      execute: async (raw) => {
        const confirmed = raw.confirm === true;
        const guardOf = (key: string, value: unknown): unknown => {
          const view = ports.api.settings.get(key);
          if (!view) return refusal(unknownSetting(key));
          // Only the direction that disarms the safeguard is refused: the
          // manifest entry owns that test, so re-ENABLING a consent screen is
          // an ordinary write. The sentence is itself the refusal — the only
          // place it reaches a human, since the MCP client shows only the verb
          // name and its arguments.
          const consequence = ports.api.settings.consequenceOf(key, value);
          if (consequence && !confirmed) {
            return refusal(`${consequence} Call again with confirm: true to proceed.`, {
              key,
              requiresConfirmation: true,
            });
          }
          return undefined;
        };

        // Before the gate, like sessionGate's precheck: a call that is already
        // doomed must not raise an approval card for it.
        const doomed = guardOf(String(raw.key), raw.value);
        if (doomed) return doomed;

        return op("setting_set", "agent.setting_changed", (a) => {
          const key = String(a.key);
          const view = ports.api.settings.get(key);
          return {
            key,
            guarded: !!view?.consequence,
            confirmed,
            // Values are user content — a shell path, a theme id. Only a
            // boolean is safe to put on a row that can leave the device.
            ...(view?.type === "boolean" ? { value: a.value } : {}),
          };
        }, raw, async (a) => {
          // The approval decision may have rewritten the arguments, so the
          // guard is re-run on what is actually about to be written — the
          // hazard sessionGate documents for its own scope.
          const stillDoomed = guardOf(String(a.key), a.value);
          if (stillDoomed) return stillDoomed;
          return unwrapDomain(ports.api.settings.set(String(a.key), a.value));
        });
      },
    },
  ];
}
