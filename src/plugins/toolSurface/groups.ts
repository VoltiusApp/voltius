import type { Tool } from "./types";
import type { ToolSurfacePorts } from "./coreTools";
import { buildFileTools, FILE_PERMISSIONS } from "./tools/files";
import { buildSessionTools, SESSION_PERMISSIONS } from "./tools/sessions";
import { buildConnectionTools, CONNECTION_PERMISSIONS } from "./tools/connections";
import { buildKeyTools, KEY_PERMISSIONS } from "./tools/keys";
import { buildIdentityTools, IDENTITY_PERMISSIONS } from "./tools/identities";
import { buildAuditTools, AUDIT_PERMISSIONS } from "./tools/audit";
import { buildVaultTools, VAULT_PERMISSIONS } from "./tools/vaults";
import { buildFolderTools, FOLDER_PERMISSIONS } from "./tools/folders";
import { buildObjectTools, OBJECT_PERMISSIONS } from "./tools/objects";
import { buildSnippetTools, SNIPPET_PERMISSIONS } from "./tools/snippets";
import { buildPortForwardTools, PORT_FORWARD_PERMISSIONS } from "./tools/portForwards";
import { buildKnownHostTools, KNOWN_HOST_PERMISSIONS } from "./tools/knownHosts";
import { buildHistoryTools, HISTORY_PERMISSIONS } from "./tools/history";
import { buildSnippetRunTools, SNIPPET_RUN_PERMISSIONS } from "./tools/snippetRun";
import { buildTransferTools, TRANSFER_PERMISSIONS } from "./tools/transfers";
import { buildTelemetryTools, TELEMETRY_PERMISSIONS } from "./tools/telemetry";
import { buildPaneTools, PANE_PERMISSIONS } from "./tools/panes";
import { buildTeamTools, TEAM_PERMISSIONS } from "./tools/team";

/** One entry per domain: builder and permissions travel together so they cannot drift. */
const GROUPS = [
  { build: buildConnectionTools, permissions: CONNECTION_PERMISSIONS },
  { build: buildSessionTools, permissions: SESSION_PERMISSIONS },
  { build: buildPaneTools, permissions: PANE_PERMISSIONS },
  { build: buildFileTools, permissions: FILE_PERMISSIONS },
  { build: buildKeyTools, permissions: KEY_PERMISSIONS },
  { build: buildIdentityTools, permissions: IDENTITY_PERMISSIONS },
  { build: buildAuditTools, permissions: AUDIT_PERMISSIONS },
  { build: buildVaultTools, permissions: VAULT_PERMISSIONS },
  { build: buildFolderTools, permissions: FOLDER_PERMISSIONS },
  { build: buildObjectTools, permissions: OBJECT_PERMISSIONS },
  { build: buildSnippetTools, permissions: SNIPPET_PERMISSIONS },
  { build: buildPortForwardTools, permissions: PORT_FORWARD_PERMISSIONS },
  { build: buildKnownHostTools, permissions: KNOWN_HOST_PERMISSIONS },
  { build: buildHistoryTools, permissions: HISTORY_PERMISSIONS },
  { build: buildSnippetRunTools, permissions: SNIPPET_RUN_PERMISSIONS },
  { build: buildTransferTools, permissions: TRANSFER_PERMISSIONS },
  { build: buildTelemetryTools, permissions: TELEMETRY_PERMISSIONS },
  { build: buildTeamTools, permissions: TEAM_PERMISSIONS },
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
