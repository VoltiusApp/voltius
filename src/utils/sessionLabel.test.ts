import { test, expect } from "vitest";
import type { TerminalSession } from "@/types";
import { normalizeTabTitle, sessionLabel, splitTabLabel, TAB_TITLE_MAX } from "./sessionLabel";
import type { SplitTab } from "@/stores/layoutStore";

const session: TerminalSession = { id: "s1", connectionId: "c1", connectionName: "srv", status: "connected", type: "ssh" };

const tab: SplitTab = {
  id: "t1",
  root: { type: "leaf", id: "p1", sessionId: "s1" },
  activePaneId: "p1",
  maximizedPaneId: null,
  broadcastActive: false,
};

test("a session falls back to its connection name until it is given a title", () => {
  expect(sessionLabel(session)).toBe("srv");
  expect(sessionLabel({ ...session, title: "deploy" })).toBe("deploy");
});

test("a split tab shows its own name, else the active pane's session label", () => {
  expect(splitTabLabel(tab, session, "fallback")).toBe("srv");
  expect(splitTabLabel(tab, { ...session, title: "deploy" }, "fallback")).toBe("deploy");
  expect(splitTabLabel({ ...tab, name: "prod" }, { ...session, title: "deploy" }, "fallback")).toBe("prod");
});

test("a split tab with no active session left still names itself", () => {
  expect(splitTabLabel(tab, undefined, "fallback")).toBe("fallback");
  expect(splitTabLabel({ ...tab, name: "prod" }, undefined, "fallback")).toBe("prod");
});

test("a typed title is trimmed, capped, and cleared when it holds no text", () => {
  expect(normalizeTabTitle("  deploy  ")).toBe("deploy");
  expect(normalizeTabTitle("")).toBeUndefined();
  expect(normalizeTabTitle("   ")).toBeUndefined();
  expect(normalizeTabTitle(null)).toBeUndefined();
  expect(normalizeTabTitle("x".repeat(80))).toBe("x".repeat(TAB_TITLE_MAX));
});
