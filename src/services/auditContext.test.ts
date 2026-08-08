import { describe, expect, it } from "vitest";
import { PLUGIN_AUDIT_ACTIONS } from "./auditContext";

describe("PLUGIN_AUDIT_ACTIONS", () => {
  it("includes the generic object lifecycle actions", () => {
    expect(PLUGIN_AUDIT_ACTIONS).toContain("agent.object_created");
    expect(PLUGIN_AUDIT_ACTIONS).toContain("agent.object_updated");
    expect(PLUGIN_AUDIT_ACTIONS).toContain("agent.object_deleted");
  });

  it("keeps the array in sync with the union", () => {
    expect(new Set(PLUGIN_AUDIT_ACTIONS).size).toBe(PLUGIN_AUDIT_ACTIONS.length);
  });
});
