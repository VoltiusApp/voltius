import type { Tool } from "./types";
import type { ToolSurfacePorts } from "./coreTools";
import { buildFileTools, FILE_PERMISSIONS } from "./tools/files";
import { buildSessionTools, SESSION_PERMISSIONS } from "./tools/sessions";
import { buildConnectionTools, CONNECTION_PERMISSIONS } from "./tools/connections";
import { buildKeyTools, KEY_PERMISSIONS } from "./tools/keys";
import { buildIdentityTools, IDENTITY_PERMISSIONS } from "./tools/identities";

/** One entry per domain: builder and permissions travel together so they cannot drift. */
const GROUPS = [
  { build: buildConnectionTools, permissions: CONNECTION_PERMISSIONS },
  { build: buildSessionTools, permissions: SESSION_PERMISSIONS },
  { build: buildFileTools, permissions: FILE_PERMISSIONS },
  { build: buildKeyTools, permissions: KEY_PERMISSIONS },
  { build: buildIdentityTools, permissions: IDENTITY_PERMISSIONS },
] as const;

export const ALL_PERMISSIONS: readonly string[] = [
  ...new Set(GROUPS.flatMap((g) => [...g.permissions])),
];

/** The consumer-agnostic verb set. Planning stays with the consumer that has a UI for it. */
export function buildCoreTools(ports: ToolSurfacePorts): Tool[] {
  const tools = GROUPS.flatMap((g) => g.build(ports));
  const descriptions = ports.text?.descriptions;
  return descriptions
    ? tools.map((t) => ({ ...t, description: descriptions[t.name] ?? t.description }))
    : tools;
}
