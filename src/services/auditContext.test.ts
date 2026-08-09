import { describe, expect, it } from "vitest";
import { PLUGIN_AUDIT_ACTIONS, type PluginAuditAction } from "./auditContext";

// Fails to compile if PluginAuditAction gains a member missing from this map,
// so the runtime check below actually pins the union, not just "no dupes".
const _cover: Record<PluginAuditAction, true> = {
  "agent.grant_created": true,
  "agent.grant_revoked": true,
  "agent.mode_changed": true,
  "agent.session_opened": true,
  "agent.session_closed": true,
  "agent.command_run": true,
  "agent.action_denied": true,
  "agent.file_created": true,
  "agent.file_written": true,
  "agent.file_renamed": true,
  "agent.file_deleted": true,
  "agent.file_transferred": true,
  "agent.object_created": true,
  "agent.object_updated": true,
  "agent.object_deleted": true,
  "agent.plugin_tool_run": true,
};

describe("PLUGIN_AUDIT_ACTIONS", () => {
  it("includes the generic object lifecycle actions", () => {
    expect(PLUGIN_AUDIT_ACTIONS).toContain("agent.object_created");
    expect(PLUGIN_AUDIT_ACTIONS).toContain("agent.object_updated");
    expect(PLUGIN_AUDIT_ACTIONS).toContain("agent.object_deleted");
  });

  it("keeps the array in sync with the union: the runtime rejects any action not in it", () => {
    expect(new Set(PLUGIN_AUDIT_ACTIONS)).toEqual(new Set(Object.keys(_cover)));
  });
});
