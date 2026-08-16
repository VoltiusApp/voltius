import { describe, expect, it, test } from "vitest";
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
  "agent.keys_sent": true,
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
  "agent.member_invited": true,
  "agent.member_removed": true,
  "agent.member_role_changed": true,
  "agent.session_shared": true,
  "agent.session_unshared": true,
  "agent.control_granted": true,
  "agent.setting_changed": true,
  "agent.plugin_installed": true,
  "agent.plugin_removed": true,
  "agent.plugin_enabled": true,
  "agent.plugin_disabled": true,
  "agent.plugin_updated": true,
  "agent.plugin_configured": true,
  "agent.marketplace_source_changed": true,
  "agent.objects_imported": true,
  "agent.objects_exported": true,
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

test("the P7 team and sharing actions are in the plugin audit vocabulary", () => {
  for (const action of [
    "agent.member_invited",
    "agent.member_removed",
    "agent.member_role_changed",
    "agent.session_shared",
    "agent.session_unshared",
    "agent.control_granted",
  ]) {
    expect(PLUGIN_AUDIT_ACTIONS).toContain(action);
  }
});

test("the settings verb's action is in the plugin audit vocabulary", () => {
  expect(PLUGIN_AUDIT_ACTIONS).toContain("agent.setting_changed");
});

it("carries the P9 plugin and import/export actions", () => {
  for (const a of [
    "agent.plugin_installed", "agent.plugin_removed", "agent.plugin_enabled",
    "agent.plugin_disabled", "agent.plugin_updated", "agent.plugin_configured",
    "agent.marketplace_source_changed", "agent.objects_imported", "agent.objects_exported",
  ]) {
    expect(PLUGIN_AUDIT_ACTIONS).toContain(a);
  }
});
