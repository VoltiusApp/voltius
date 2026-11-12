import { describe, expect, test } from "vitest";
import { buildSnapshot, parseSnapshot, type SnapshotLayout } from "./workspaceSnapshotCore.ts";

const layout: SnapshotLayout = {
  splitTabs: [{ id: "T" }],
  activeSplitTabId: null,
  splitTabActive: false,
  titlebarOrder: ["session:a", "split:T"],
  pinnedKeys: ["session:a", "split:T"],
};

describe("lock and pin in the workspace snapshot", () => {
  test("survive a build and parse round-trip", () => {
    const snap = buildSnapshot({
      sessions: [{ id: "a", type: "local", connectionId: "local", connectionName: "zsh", locked: true }],
      cwds: {},
      layout,
      activeSessionId: "a",
    });
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snap)))!;
    expect(parsed.sessions[0].locked).toBe(true);
    expect(parsed.layout.pinnedKeys).toEqual(["session:a", "split:T"]);
  });

  test("an older snapshot without them restores with nothing locked or pinned", () => {
    const old = {
      version: 1, savedAt: "", activeSessionId: null,
      layout: { splitTabs: [], activeSplitTabId: null, splitTabActive: false, titlebarOrder: ["session:a"] },
      sessions: [{ id: "a", type: "local", connectionId: "local", connectionName: "zsh", persist: false }],
    };
    const parsed = parseSnapshot(old)!;
    expect(parsed.sessions[0].locked).toBe(false);
    expect(parsed.layout.pinnedKeys).toEqual([]);
  });

  test("pins that name a missing tab or are not strings are dropped", () => {
    const raw = {
      version: 1, savedAt: "", activeSessionId: null,
      layout: { splitTabs: [{ id: "T" }], activeSplitTabId: null, splitTabActive: false, titlebarOrder: [], pinnedKeys: ["session:gone", 3, "split:T", "split:X"] },
      sessions: [{ id: "a", type: "local", connectionId: "local", connectionName: "zsh" }],
    };
    expect(parseSnapshot(raw)!.layout.pinnedKeys).toEqual(["split:T"]);
  });
});
