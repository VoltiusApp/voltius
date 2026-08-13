import { test, expect, vi, beforeEach } from "vitest";
import type { TerminalSession } from "@/types";

const { duplicateSession, reconnect } = vi.hoisted(() => ({ duplicateSession: vi.fn(), reconnect: vi.fn() }));

vi.mock("@/services/duplicateSession", async () => {
  const actual = await vi.importActual<typeof import("@/services/duplicateSession")>("@/services/duplicateSession");
  return { ...actual, duplicateSession };
});
vi.mock("@/stores/sessionStore", () => ({ useSessionStore: { getState: () => ({ reconnect }) } }));
vi.mock("@/stores/shortcutStore", () => ({ getShortcutHint: (id: string) => `hint:${id}` }));

import { sessionMenuItems } from "./sessionMenuItems";

const session: TerminalSession = { id: "s1", connectionId: "c1", connectionName: "srv", status: "connected", type: "ssh" };
const t = ((key: string) => key) as never;
const onClose = vi.fn();

const build = (over: Partial<TerminalSession> = {}) =>
  sessionMenuItems({ session: { ...session, ...over }, t, closeLabel: "close-it", onClose });

beforeEach(() => vi.clearAllMocks());

test("duplicate entries target a tab and a right split, and carry their shortcut hints", () => {
  const items = build();
  const labels = items.map((i) => i.label);
  expect(labels).toEqual(["panes.header.duplicate", "panes.header.duplicateSplit", "panes.header.reconnect", "close-it"]);

  items[0].onClick!();
  expect(duplicateSession).toHaveBeenCalledWith("s1", "tab");
  items[1].onClick!();
  expect(duplicateSession).toHaveBeenCalledWith("s1", "right");
  expect(items[0].shortcut).toBe("hint:duplicate-session");
  expect(items[1].shortcut).toBe("hint:duplicate-session-split");
});

test("sessions that cannot be duplicated get no duplicate entries", () => {
  const items = build({ type: "serial" });
  expect(items.map((i) => i.label)).toEqual(["panes.header.reconnect", "close-it"]);
});

test("reconnect and close are wired to the store and the caller", () => {
  const items = build();
  items[2].onClick!();
  expect(reconnect).toHaveBeenCalledWith("s1");
  items[3].onClick!();
  expect(onClose).toHaveBeenCalled();
  expect(items[3].danger).toBe(true);
});
