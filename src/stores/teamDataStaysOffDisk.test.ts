// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ teamIds: new Set<string>() }));
vi.mock("@/services/teamConnectionIds", () => ({ isTeamConnection: (id: string) => h.teamIds.has(id) }));

import { useCommandHistoryStore } from "./commandHistoryStore";
import { rememberVars, rememberedVars, useHostCommandVarsStore } from "./hostCommandVarsStore";
import { buildSnapshot } from "./workspaceSnapshotCore";

const persisted = <S>(store: { persist: { getOptions: () => { partialize?: (s: S) => unknown } }; getState: () => S }) =>
  JSON.stringify(store.persist.getOptions().partialize!(store.getState()));

beforeEach(() => {
  h.teamIds = new Set(["team-host"]);
  useCommandHistoryStore.setState({ entries: [], buffers: {} });
  useHostCommandVarsStore.setState({ values: {}, teamKeys: {} });
});

test("commands typed on a team host stay in memory only", () => {
  useCommandHistoryStore.getState().addInput("s1", "prod", "team-host", "cat /etc/team-secret\r");
  useCommandHistoryStore.getState().addInput("s2", "mine", "own-host", "ls\r");

  expect(useCommandHistoryStore.getState().entries.map((e) => e.command)).toEqual(["cat /etc/team-secret", "ls"]);
  expect(persisted(useCommandHistoryStore)).not.toContain("team-secret");
  expect(persisted(useCommandHistoryStore)).toContain("ls");
});

test("snippet variables remembered for a team host stay in memory only", () => {
  const text = { name: "env", type: "text", dynamic: false } as const;
  rememberVars("team-host", "s1", { env: "team-prod" }, [text]);
  rememberVars("own-host", "s1", { env: "mine" }, [text]);

  expect(rememberedVars("team-host", "s1")).toEqual({ env: "team-prod" });
  expect(persisted(useHostCommandVarsStore)).not.toContain("team-prod");
  expect(persisted(useHostCommandVarsStore)).toContain("mine");
});

test("the workspace snapshot leaves out tabs on team hosts", () => {
  const snap = buildSnapshot({
    sessions: [
      { id: "a", type: "ssh", connectionId: "team-host", connectionName: "prod" },
      { id: "b", type: "ssh", connectionId: "own-host", connectionName: "mine" },
    ],
    cwds: { a: "/srv/team" },
    layout: { splitTabs: [], activeSplitTabId: null, splitTabActive: false, titlebarOrder: [] },
    activeSessionId: "a",
    isTeamConnection: (id) => h.teamIds.has(id),
  });

  expect(snap.sessions.map((s) => s.id)).toEqual(["b"]);
  expect(snap.activeSessionId).toBeNull();
});

test("history and variables saved by older builds for team hosts are dropped from disk once team hosts load", async () => {
  const { scrubTeamDataFromDisk } = await import("@/services/teamDataScrub");
  useCommandHistoryStore.setState({ entries: [
    { id: "1", command: "old team cmd", timestamp: 1, sessionId: "s", sessionName: "prod", connectionId: "team-host" },
    { id: "2", command: "old own cmd", timestamp: 2, sessionId: "s", sessionName: "mine", connectionId: "own-host" },
  ] });
  useHostCommandVarsStore.setState({ values: { "team-host s1": { env: "old-team" }, "own-host s1": { env: "old-own" } }, teamKeys: {} });

  scrubTeamDataFromDisk();

  expect(persisted(useCommandHistoryStore)).not.toContain("old team cmd");
  expect(persisted(useCommandHistoryStore)).toContain("old own cmd");
  expect(persisted(useHostCommandVarsStore)).not.toContain("old-team");
  expect(useCommandHistoryStore.getState().entries).toHaveLength(2);
});
