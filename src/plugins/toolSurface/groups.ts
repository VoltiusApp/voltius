import type { Tool } from "./types";
import type { ToolSurfacePorts } from "./coreTools";
import { buildFileTools, FILE_PERMISSIONS } from "./tools/files";
import { buildSessionTools, SESSION_PERMISSIONS } from "./tools/sessions";
import { buildConnectionTools, CONNECTION_PERMISSIONS } from "./tools/connections";
import { buildKeyTools, KEY_PERMISSIONS } from "./tools/keys";

export const ALL_PERMISSIONS: readonly string[] = [
  ...new Set([...FILE_PERMISSIONS, ...SESSION_PERMISSIONS, ...CONNECTION_PERMISSIONS, ...KEY_PERMISSIONS]),
];

/** The consumer-agnostic verb set. Planning stays with the consumer that has a UI for it. */
export function buildCoreTools(ports: ToolSurfacePorts): Tool[] {
  const tools = [
    ...buildConnectionTools(ports),
    ...buildSessionTools(ports),
    ...buildFileTools(ports),
    ...buildKeyTools(ports),
  ];
  const descriptions = ports.text?.descriptions;
  return descriptions
    ? tools.map((t) => ({ ...t, description: descriptions[t.name] ?? t.description }))
    : tools;
}
