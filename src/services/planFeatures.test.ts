// @vitest-environment jsdom
import { test, expect } from "vitest";
import i18n from "@/i18n";
import { PLAN_FEATURES, freeForEveryone, planFeatureLabel } from "./planFeatures";

const sharingLabel = (tier: keyof typeof PLAN_FEATURES) =>
  planFeatureLabel(i18n.t, PLAN_FEATURES[tier].find((f) => f.id === "terminalSharing")!);

test("terminal sharing labels carry each plan's server caps", () => {
  expect(sharingLabel("pro")).toBe("Terminal sharing: 1 session, 1 guest");
  expect(sharingLabel("teams")).toBe("Terminal sharing: 5 sessions, 10 guests each");
  expect(sharingLabel("business")).toBe("Terminal sharing: 20 sessions, 50 guests each");
});

test("free-for-everyone leaves out the free vault limit and, off local sync, the LAN features", () => {
  expect(freeForEveryone(true).map((f) => f.id)).toEqual(["localSync", "deviceFiles", "syncPlugins", "auditLogs"]);
  expect(freeForEveryone(false).map((f) => f.id)).toEqual(["syncPlugins", "auditLogs"]);
});

test("every plan feature has an English label", () => {
  for (const f of Object.values(PLAN_FEATURES).flat()) {
    expect(planFeatureLabel(i18n.t, f)).not.toContain("settings.account");
  }
});
