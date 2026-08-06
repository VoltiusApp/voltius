import { test, expect } from "vitest";
import { ACTION_META } from "./AuditEventRow";
import { PLUGIN_AUDIT_ACTIONS } from "@/services/auditContext";
import en from "@/i18n/locales/en/logs.json";

// Without this a new action falls through to FALLBACK_META and renders its raw
// dotted string in the audit log — which is what every agent action did until
// the file actions were added.
test("every plugin audit action has a row label", () => {
  const missing = PLUGIN_AUDIT_ACTIONS.filter((a) => !ACTION_META[a]);
  expect(missing).toEqual([]);
});

test("every action label resolves to a real string", () => {
  const labels = en.logs.eventLabels as Record<string, string>;
  for (const action of PLUGIN_AUDIT_ACTIONS) {
    const key = "agent" + action.slice("agent.".length)
      .replace(/(^|_)(\w)/g, (_, __, c: string) => c.toUpperCase());
    expect(labels[key], `logs.eventLabels.${key} for ${action}`).toBeTruthy();
  }
});
